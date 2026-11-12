# Precipitation type viewer (static site)

A static React site that shows HRRR precipitation-type forecasts from the
evidential neural network, HRRR overlay fields, and an editable sounding at any
point. There is no server: the browser reads Zarr from object storage, decodes
HRRR GRIB2 straight from NOAA's bucket, and runs the network itself.

## Run it locally

```bash
npm install
```

```bash
npm run dev
```

Then open the URL Vite prints. Without sample data you still get the map and
all HRRR fields for any run on NOAA's bucket; the precipitation-type layer and
soundings need the stores below.

### Sample data

`public/sample-data/` is not committed (about 45 MB). Build it from a MILES netCDF file:

```bash
python tools/make_sample_data.py ../backend/data/MILES_ptype_hrrr_2024-04-30_0000_f*.nc
```

Needs `xarray zarr topozarr xproj pyproj h5netcdf`. Pass several forecast-hour
files to get an animation.

### Real data

Copy `.env.example` to `.env.local` and set the bucket URLs. The layouts the
site expects are in [docs/data-schema.md](docs/data-schema.md).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | development server |
| `npm test` | unit tests (projection, time rules, sounding statistics, model parity with Keras) |
| `npm run build` | type-check and build to `dist/` |
| `npm run preview` | serve the built site |

## Deploying

`.github/workflows/deploy-web.yml` builds and publishes to GitHub Pages on pushes
to `main`. Set the data URLs as repository variables (see the comment at the top
of that file). The build uses relative paths, so it works at
`https://<org>.github.io/ptype-web/` and at a custom domain without changes.

## Where things are

| Path | Contents |
|---|---|
| `src/config/dataSources.ts` | every remote URL |
| `src/config/ptypeStyle.ts` | precipitation-type colours |
| `src/fields/registry.ts` | HRRR overlay fields; add an entry to add a field |
| `src/map/` | MapLibre map, basemap style, autumnplot-gl layers |
| `src/data/` | readers: manifest, topozarr, sounding Zarr, HRRR GRIB |
| `src/sounding/` | skew-T, hodograph, probability bars, editing maths, statistics |
| `src/model/` | ONNX Runtime wrapper and evidential post-processing |
| `src/time/` | calendar, slider, animation, keyboard shortcuts |
| `src/state/store.ts` | application state (zustand) |
| `src/vendor/gribjs/` | vendored GRIB2 decoder (see its README) |
| `tools/` | `export_onnx.py`, `make_sample_data.py`, `make_test_fixtures.py`, `build_overlays.sh` |

### Adding an HRRR field

Append an entry to `FIELDS` in `src/fields/registry.ts`: the GRIB messages it
needs (strings from any `.idx` file, for example `:TMP:850 mb:`), a function that
turns them into the plotted values, and a style (contours, filled raster or
barbs). It then appears in the layer menu.

### Updating the model

```bash
KERAS_BACKEND=torch python tools/export_onnx.py --model <model.keras> --scaler <scaler.json> --out public/model --fixtures src/model/fixtures.json --sample-nc <MILES file.nc>
```

The script fails if the ONNX output differs from Keras; `npm test` then checks
the browser-side code against the same fixtures.

## Keyboard

`←`/`→` or `,`/`.` step the forecast hour, `Space` plays or pauses, `Home`/`End`
jump to the first or last hour, `Shift`+`←`/`→` change the model run, `[`/`]`
change the animation speed, `?` lists the shortcuts.

## Third-party pieces

- [autumnplot-gl](https://github.com/tsupinie/autumnplot-gl) draws the fields. Its prebuilt browser bundle is copied to `public/autumnplot/` at build time (see `vite.config.ts`).
- [gribjs](https://github.com/tsupinie/gribjs) decodes GRIB2 (vendored).
- Basemap tiles, highways and city labels come from [OpenFreeMap](https://openfreemap.org); counties and NWS county warning areas are GeoJSON in `public/overlays/` (`tools/build_overlays.sh`).
