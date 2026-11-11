#!/usr/bin/env bash
# Rebuild the boundary overlays in public/overlays (needs GDAL's ogr2ogr and curl).
#   counties.geojson  US counties (Census 2010 20m file already in this repo)
#   cwas.geojson      NWS county warning areas (weather.gov/gis/CWABounds)
# Highways, cities, states and coastlines come from the vector basemap tiles.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=public/overlays
CWA_ZIP=${CWA_ZIP:-https://www.weather.gov/source/gis/Shapefiles/WSOM/w_16ap26.zip}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

rm -f "$OUT/counties.geojson" "$OUT/cwas.geojson"
ogr2ogr -f GeoJSON "$OUT/counties.geojson" ../frontend/src/maps/gz_2010_us_050_00_20m.json \
  -select NAME,STATE -lco COORDINATE_PRECISION=3 -lco RFC7946=YES

curl -sL -o "$TMP/cwa.zip" "$CWA_ZIP"
unzip -q -o "$TMP/cwa.zip" -d "$TMP"
ogr2ogr -f GeoJSON "$OUT/cwas.geojson" "$TMP"/*.shp -t_srs EPSG:4326 \
  -select CWA,WFO -simplify 0.01 -lco COORDINATE_PRECISION=3 -ct_opt WARN_ABOUT_DIFFERENT_COORD_OP=NO
ls -lh "$OUT"
