# gribjs (vendored)

TypeScript sources from https://github.com/tsupinie/gribjs at commit
`623d4245dac5713e5a4cddff2b774f31e6ac40fd` (MIT, see LICENSE). gribjs is not
published to npm and its WebAssembly decoder is not checked into that repo, so
both are kept here.

`compiled/grib_compression.{js,wasm}` was built with Emscripten from gribjs's
`src/compiled/*.c`, with `decode_openjpeg.c` replaced by `jpeg_stub.c`
(JPEG2000 is not needed: HRRR uses complex packing with spatial differencing):

```bash
emcc -O2 extract_bytes.c bitstream.c decode_png.c jpeg_stub.c unpk_complex.c decode_bitmap.c \
  -o grib_compression.js -sUSE_LIBPNG -sENVIRONMENT=web,worker -sMODULARIZE=1 -sEXPORT_ES6=1 \
  -sALLOW_MEMORY_GROWTH \
  -sEXPORTED_FUNCTIONS="['_decode_png','_decode_jpeg2000','_unpk_complex','_unpk_sd_complex','_apply_bitmap','_malloc','_free']" \
  -sEXPORTED_RUNTIME_METHODS="['cwrap','setValue','getValue']"
```

Changes to the TypeScript:

- a `// @ts-nocheck` header on each file;
- `grib2datarepdefs.ts`: simple packing (template 5.0) is implemented, since some HRRR
  fields (for example 10 m wind in 2024 files) use it and upstream throws "not implemented".
