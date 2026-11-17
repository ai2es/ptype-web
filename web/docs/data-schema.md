# Data the viewer reads

The site is static. Everything it shows comes from four places, all set in
`src/config/dataSources.ts` (override with `VITE_*` variables, see `.env.example`).
By default the forecasts and soundings come from the `wwe-ptype` S3 bucket, written by the
`ptype.hrrr_fast` pipeline in [ptype-physical](https://github.com/ai2es/ptype-physical).
`tools/make_sample_data.py` writes a small local example of the first two in an older layout that is still read.

The bucket answers only requests whose `Referer` is this site or a localhost dev server, so a missing object
returns 403, not 404.

Every bucket must allow cross-origin `GET` and `HEAD` requests with the `Range`
header from the site's origin.

## 1. Precipitation-type forecasts (`VITE_PTYPE_URL`)

```
<root>/inits.json
<root>/2024/04/30/hrrr_ptype_20240430_0000.zarr/
```

### `inits.json`

Lists the runs that have a forecast. It drives the calendar and the
"precip type available" indicator. Rewrite it whenever a run is added.

```json
{
  "version": 1,
  "inits": [
    {
      "init": "2024-04-30T00:00Z",
      "forecast_hours": [1, 2, 3],
      "store": "2024/04/30/hrrr_ptype_20240430_0000.zarr",
      "soundings": "soundings/2024/04/30/hrrr_soundings_20240430_0000.zarr"
    }
  ]
}
```

- `init`: initialization time, UTC.
- `forecast_hours`: hours present in the store. `max_forecast_hour` (hours 1..N) is accepted instead.
- `store`: path relative to the root, or an absolute URL. Optional; the default is the path pattern above.
- `soundings`: this run's sounding store, relative to the sounding root (`VITE_SOUNDING_URL`, by default the
  bucket itself, one level above the forecast root), or an absolute URL. Optional; the default is
  `soundings/YYYY/MM/DD/hrrr_soundings_YYYYMMDD_HH00.zarr`.

### One topozarr store per run

A Zarr v3 multiscale store written by [topozarr](https://pypi.org/project/topozarr/)
(`create_pyramid(ds, ...).write(path)`), on the native HRRR Lambert grid.

- Root attributes used: `multiscales.layout[*]` (`asset`, `spatial:transform`, `spatial:shape`)
  and `proj:code` (a PROJ string with `+proj=lcc`). topozarr writes these when the
  dataset has a CRS and `x`/`y` coordinates in projected metres.
- Each level group holds `forecast_hour` (int) and these float32 arrays on
  `(forecast_hour, y, x)`:

| Variable | Meaning |
|---|---|
| `ML_rain`, `ML_snow`, `ML_icep`, `ML_frzr` | class probabilities |
| `ML_u` | evidential uncertainty, `u = K / S` |

Rows may run south to north or north to south; the sign of the y term in
`spatial:transform` says which. Chunk so that one forecast hour of one level is
a small number of chunks (topozarr's defaults do this).

They also hold the revised Bourgouin diagnosis (Birk et al. 2021) as `BOURG_rain`, `BOURG_snow`, `BOURG_icep`,
`BOURG_frzr` (independent probabilities, 0 to 1, which need not sum to 1) and `BOURG_class`. The "Revised Bourgouin
method" layer draws the largest of the four, shaded by its value, in place of the network's layer; cells where all
four are zero are left blank.

Stores written by `ptype.hrrr_fast` also hold `precip_mask` (uint8, 1 where any HRRR categorical type is
set) at every level, listed under the root attribute `hrrr_ptype.variables`. When it is there the site masks
with it and does not download the four categorical fields from NOAA.

The map shows the most likely class shaded by its probability. By default it
is masked to where the HRRR's own categorical fields report precipitation;
those come straight from NOAA (below), not from this store.

## 2. Soundings (`VITE_SOUNDING_URL`)

One Zarr v3 store per run:

| Array | Shape | Notes |
|---|---|---|
| `sounding` | `(forecast_hour, location, variable)` float32 | inner chunks `(1, N, all)` inside one shard per forecast hour; N around 1024 keeps a click to one small range request |
| `forecast_hour` | `(forecast_hour,)` int32 | |

`u_ms` and `v_ms` are earth-relative (east, north) when the root attribute `wind_frame` is `"earth_relative"`,
which is what the hodograph and wind barbs show. The network was trained on winds relative to the HRRR grid, so
before re-running it the site rotates them back by `alpha = sin(lat_std) * (lon - lon_0)` at the clicked cell
(`gridRelativeWind` in `src/model/evidential.ts`). Checked against the bucket at six precipitating cells across
the domain: with the rotation the re-run probabilities are within 0.017 of the map's, without it up to 0.20.

A store whose `sounding` array has four dimensions, `(init_time, forecast_hour, location, variable)` with an
`init_time` array in seconds since 1970-01-01 UTC, is the older single-store layout and is still read (set
`VITE_SOUNDING_URL` to that store's `.zarr` URL).

Root attributes:

```json
{
  "grid": {
    "projection": "lambert_conformal",
    "ni": 787, "nj": 458, "dx": 3000.0, "dy": 3000.0,
    "ll_x": -1122520.0, "ll_y": -201310.0,
    "lon_0": -97.5, "lat_0": 38.5, "lat_std": [38.5, 38.5], "earth_radius": 6371229.0
  },
  "heights_m": [0, 250, 500, "...", 5000],
  "variable_groups": ["temperature_c", "dewpoint_c", "u_ms", "v_ms", "pressure_hpa"]
}
```

- `location = j * ni + i`, with `i` west to east and `j` south to north.
  `ll_x`, `ll_y` are the projected coordinates (metres) of the centre of cell (0, 0).
  The browser turns a clicked lat/lon into `location` with these numbers, so no lookup table is needed.
- `variable` is the groups concatenated, each ordered surface to top (5 x 21 = 105 values).
  The first four groups, in this order, are exactly the network's input. Pressure is used
  only to place the levels on the skew-T.
- Units: deg C, deg C, m/s, m/s, hPa. Winds are grid-relative, as in the HRRR.

## 3. The model (`VITE_MODEL_URL`, `VITE_MODEL_META_URL`)

`tools/export_onnx.py` converts the Keras model to `ptype_model.onnx` and writes
`ptype_model.json` with the scaler constants, level heights and class order. By
default both are served from `public/model/`. To host them elsewhere (S3, or a
Hugging Face repo via `https://huggingface.co/<org>/<repo>/resolve/main/<file>`),
set the two variables. The host must send CORS headers.

The browser scales the inputs, runs the ONNX graph with ONNX Runtime Web, and
applies the evidential post-processing (`alpha = relu(y) + 1`, `p = alpha / S`,
`u = K / S`). `src/model/ptypeModel.test.ts` checks this against Keras outputs.

## 4. HRRR fields (`VITE_HRRR_URL`)

Read directly from `https://noaa-hrrr-bdp-pds.s3.amazonaws.com`:
`hrrr.YYYYMMDD/conus/hrrr.tHHz.wrfsfcfFF.grib2` and its `.idx`. The `.idx` gives
the byte range of each message, so only the fields that are switched on are
downloaded. No preprocessing is needed for real-time or archived runs.
