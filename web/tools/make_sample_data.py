"""Build small sample stores for local development from MILES netCDF files.

Writes, under --out (default public/sample-data):
  ptype/inits.json                                       manifest of available runs
  ptype/YYYY/MM/DD/hrrr_ptype_YYYYMMDD_HHMM.zarr         topozarr multiscale store
  soundings.zarr                                         (init_time, forecast_hour, location, variable)

The layout is the one documented in docs/data-schema.md; the production
pipeline should write the same thing to the S3 buckets.

Usage (needs xarray, zarr>=3, topozarr, xproj, pyproj, h5netcdf):
  python tools/make_sample_data.py ../backend/data/MILES_ptype_hrrr_2024-04-30_0000_f*.nc
"""
import argparse
import json
import re
import shutil
from collections import defaultdict
from pathlib import Path

import numpy as np
import pyproj
import xarray as xr
import xproj  # noqa: F401  (registers the .proj accessor)
import zarr
from topozarr import create_pyramid

# HRRR Lambert conformal grid (spherical earth).
EARTH_RADIUS = 6371229.0
LON_0, LAT_0, LAT_STD = -97.5, 38.5, 38.5
DX = DY = 3000.0
CRS = pyproj.CRS.from_proj4(
    f"+proj=lcc +lat_1={LAT_STD} +lat_2={LAT_STD} +lat_0={LAT_0} +lon_0={LON_0} +R={EARTH_RADIUS} +units=m +no_defs"
)
PTYPE_VARS = ["ML_rain", "ML_snow", "ML_icep", "ML_frzr", "ML_u"]
SOUNDING_GROUPS = {"temperature_c": "t_h", "dewpoint_c": "dpt_h", "u_ms": "u_h", "v_ms": "v_h", "pressure_hpa": "isobaricInhPa_h"}
NAME_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})_f(\d{2})")


def grid_definition(ds):
    """Projected x/y coordinates and grid attributes for a MILES subset file."""
    lat = ds.latitude.values
    lon = ((ds.longitude.values + 180) % 360) - 180
    tf = pyproj.Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
    xx, yy = tf.transform(lon, lat)
    x = np.round(xx.mean(axis=0) / 10) * 10
    y = np.round(yy.mean(axis=1) / 10) * 10
    assert np.allclose(np.diff(x), DX, atol=5) and np.allclose(np.diff(y), DY, atol=5), "grid is not the 3 km HRRR grid"
    grid = {
        "projection": "lambert_conformal",
        "ni": int(x.size),
        "nj": int(y.size),
        "lon_0": LON_0,
        "lat_0": LAT_0,
        "lat_std": [LAT_STD, LAT_STD],
        "earth_radius": EARTH_RADIUS,
        "dx": DX,
        "dy": DY,
        "ll_x": float(x[0]),
        "ll_y": float(y[0]),
        "ll_lon": float(lon[0, 0]),
        "ll_lat": float(lat[0, 0]),
        "location_index": "j * ni + i, with i west to east and j south to north",
    }
    return x, y, grid


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("files", nargs="+")
    p.add_argument("--out", default="public/sample-data")
    p.add_argument("--levels", type=int, default=3, help="pyramid levels for the ptype store")
    p.add_argument("--location-chunk", type=int, default=1024)
    args = p.parse_args()

    out = Path(args.out)
    runs = defaultdict(dict)  # init ISO -> {fhour: path}
    for f in sorted(args.files):
        m = NAME_RE.search(Path(f).name)
        if not m:
            raise SystemExit(f"Cannot parse init time from {f}")
        y, mo, d, hh, mm, ff = m.groups()
        runs[f"{y}-{mo}-{d}T{hh}:{mm}Z"][int(ff)] = f

    manifest = {"version": 1, "inits": []}
    init_isos = sorted(runs)
    all_fhours = sorted({fh for r in runs.values() for fh in r})
    sounding = None

    for n_init, iso in enumerate(init_isos):
        fhours = sorted(runs[iso])
        ptype_steps = []
        for fh in fhours:
            ds = xr.open_dataset(runs[iso][fh])
            x, y, grid = grid_definition(ds)
            ptype_steps.append(
                xr.Dataset(
                    {v: (("y", "x"), ds[v].values[0].astype("float32")) for v in PTYPE_VARS},
                    coords={"x": x, "y": y},
                )
            )
            if sounding is None:
                n_loc = grid["ni"] * grid["nj"]
                n_lev = ds.sizes["heightAboveGround"]
                store_path = out / "soundings.zarr"
                shutil.rmtree(store_path, ignore_errors=True)
                root = zarr.open_group(store_path, mode="w", zarr_format=3)
                sounding = root.create_array(
                    "sounding",
                    shape=(len(init_isos), len(all_fhours), n_loc, n_lev * len(SOUNDING_GROUPS)),
                    chunks=(1, 1, args.location_chunk, n_lev * len(SOUNDING_GROUPS)),
                    dtype="float32",
                    fill_value=np.nan,
                    dimension_names=["init_time", "forecast_hour", "location", "variable"],
                )
                epoch = [int(np.datetime64(i[:-1]).astype("datetime64[s]").astype(int)) for i in init_isos]
                root.create_array("init_time", data=np.asarray(epoch, dtype="int64"), dimension_names=["init_time"])
                root.create_array("forecast_hour", data=np.asarray(all_fhours, dtype="int32"), dimension_names=["forecast_hour"])
                root.attrs.update(
                    {
                        "grid": grid,
                        "heights_m": [int(h) for h in ds.heightAboveGround.values],
                        "variable_groups": list(SOUNDING_GROUPS),
                        "variable_layout": "concatenate(variable_groups), each ordered surface to top",
                        "init_time_units": "seconds since 1970-01-01T00:00:00Z",
                    }
                )
            block = np.concatenate(
                [ds[v].values[0].reshape(n_lev, -1).T.astype("float32") for v in SOUNDING_GROUPS.values()], axis=1
            )
            sounding[n_init, all_fhours.index(fh)] = block
            ds.close()

        cube = xr.concat(ptype_steps, dim=xr.DataArray(np.asarray(fhours, dtype="int32"), dims="forecast_hour", name="forecast_hour"))
        cube = cube.proj.assign_crs(spatial_ref=CRS)
        cube.attrs["grid"] = grid
        day, hhmm = iso[:10], iso[11:13] + iso[14:16]
        rel = f"{day.replace('-', '/')}/hrrr_ptype_{day.replace('-', '')}_{hhmm}.zarr"
        store_path = out / "ptype" / rel
        shutil.rmtree(store_path, ignore_errors=True)
        store_path.parent.mkdir(parents=True, exist_ok=True)
        create_pyramid(cube, levels=args.levels, method="mean").write(str(store_path))
        manifest["inits"].append({"init": iso, "forecast_hours": fhours, "store": rel})
        print(f"{iso}: {len(fhours)} forecast hour(s) -> {store_path}")

    (out / "ptype" / "inits.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote manifest with {len(init_isos)} run(s) and {out / 'soundings.zarr'}")


if __name__ == "__main__":
    main()
