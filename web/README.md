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

Then open the URL Vite prints. The precipitation-type layer and soundings are
read from the `wwe-ptype` S3 bucket by default; its access policy admits this
site and `localhost` dev servers. HRRR fields come from NOAA's bucket for any run.

### Sample data

`public/sample-data/` is not committed (about 45 MB). Build it from a MILES netCDF file:

```bash
python tools/make_sample_data.py ../backend/data/MILES_ptype_hrrr_2024-04-30_0000_f*.nc
```

Needs `xarray zarr topozarr xproj pyproj h5netcdf`. Pass several forecast-hour
files to get an animation.

### Real data

Nothing needs to be configured to read the bucket. To read other stores, or the
sample data (`VITE_PTYPE_URL=sample-data/ptype`,
`VITE_SOUNDING_URL=sample-data/soundings.zarr`), copy `.env.example` to
`.env.local`. The layouts the site expects are in [docs/data-schema.md](docs/data-schema.md).

## Background loading

With "Preload run" ticked in the time bar (the default), the layers that are switched on are loaded for every
forecast hour of the selected run in the background, nearest hours first, two hours at a time. The thin bar
under the slider shows which hours are in memory. Each hour is kept as finished layers on the graphics card and as
quantized precipitation-type frames (see Memory below); the caches are capped (64 hours per layer and 512 MB
of frames on a desktop), and a run that does not fit stops at "memory limit" and carries on from wherever you
move to. The logic is in `src/data/prefetch.ts`.

Every HRRR layer is kept as one finished layer per forecast hour (`prebuildField` in
`src/map/WeatherLayers.ts`), and the decoded GRIB data behind it is released once the layer is built.

## Memory

Everything the site holds is tied to the selected run. Selecting another run (`useWeatherData`, "One run at a
time") drops the old run's decoded HRRR fields, precipitation-type frames, masks and prebuilt contour layers,
and deletes the prebuilt layers' graphics buffers explicitly (`disposeGl` in `src/map/WeatherLayers.ts`):
autumnplot-gl never deletes them, and the browser did not collect any on its own in testing.

Open the site with `?memdebug` and call `ptypeMemory()` in the console to see what each cache and the graphics
card hold (`src/debug/memory.ts`). `?memdebug=norelease` switches the run-change release off for comparison.
Measured in headless WebKit with 2 m temperature, sea level pressure and composite reflectivity on, preloading
a 48-hour run and then selecting three other runs in turn:

| | First run | After the third change of run |
|---|---|---|
| Old runs kept (before) | 371 MB fields, 467 MB frames, 438 MB graphics buffers | 465 MB, 505 MB, 525 MB; preload of each new run stopped at "memory limit" after 0 to 3 hours |
| Old runs released | the same | 371 MB, 467 MB, 434 MB; each new run preloaded all 48 hours; 1,325 MB of buffers deleted in total |

Within one run, memory is kept down by holding each thing in its smallest drawable form. Measured the same
way for one preloaded 48-hour run with those three layers:

| | Before | After | How |
|---|---|---|---|
| Decoded HRRR fields | 371 MB | 0 MB | every layer, rasters included, is prebuilt and its field released; the mask keeps only its bytes |
| Precipitation-type frames | 467 MB | 156 MB | probabilities stored as bytes (steps of 1/254), uncertainty as 16 bits (`src/data/ptype.ts`) |
| Graphics buffers (lines, labels) | 440 MB | 240 MB | contour labels at a quarter of the density (`LABEL_DENSITY`): they were 70% of a contour layer |
| Graphics textures | 15 MB | 190 MB | the reflectivity raster now lives here as 16-bit textures, half its decoded size |
| Masks | 22 MB | 22 MB | |
| Total | 1,315 MB | 608 MB | |

## Phones and tablets

- Filled and raster layers and wind barbs are sent to the graphics card as 16-bit floats (`src/map/float16.ts`):
  iOS cannot use 32-bit float textures and autumnplot-gl refuses them there.
- On phones and tablets (`src/config/device.ts`) "Preload run" starts switched off and the caches are much
  smaller, because one browser tab gets far less memory than on a desktop.
- If ONNX Runtime's WebAssembly build cannot start, the same network runs in plain JavaScript from
  `public/model/ptype_model_weights.bin` (`src/model/denseNet.ts`). Regenerate that file with
  `python tools/export_weights.py public/model` whenever the ONNX model changes.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | development server |
| `npm test` | unit tests (projection, time rules, sounding statistics, model parity with Keras) |
| `npm run build` | type-check and build to `dist/` |
| `npm run preview` | serve the built site |

## Deploying

`.github/workflows/deploy-web.yml` builds and publishes to GitHub Pages on pushes
to `main`. Data URLs default to the `wwe-ptype` bucket; repository variables
override them (see the comment at the top of that file). The build uses relative paths, so it works at
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
