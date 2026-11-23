#!/usr/bin/env bash
# Rebuild public/overlays/schools.pmtiles: US school locations and unified school district boundaries
# as one vector-tile archive, read by the map with byte-range requests (src/map/schools.ts).
# Needs GDAL's ogr2ogr and tippecanoe (which also provides tile-join).
#
# Source: NCES EDGE (https://nces.ed.gov/programs/edge), read from its public ArcGIS services. The
# "_Current" services are replaced each school year, so a rebuild picks up the newest files.
#   public            Public School Locations (points)
#   private           Private School Locations (points)
#   districts         School Districts, unified districts only (polygons)
#   district_labels   one point inside each district, so a name is drawn once and not once per tile
#
# Zooms: the map stops at zoom 10. Districts are tiled for zooms 5 to 8 and schools at zoom 8 only, with
# every school kept; the map stretches the zoom 8 tiles for zooms 9 and 10. A zoom 8 tile resolves about
# 30 m, under a pixel at zoom 10, and tiling to zoom 10 made the archive 32 MB.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=public/overlays/schools.pmtiles
NCES=${NCES:-https://services1.arcgis.com/Ua5sjt3LWTPigjyD/arcgis/rest/services}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# fetch <name> <service> <url-encoded where> <fields> [extra query]
# GDAL pages through the service (2,000 records a request) by itself.
fetch() {
  ogr2ogr -f GeoJSONSeq "$TMP/$1.geojsonl" \
    "ESRIJSON:$NCES/$2/FeatureServer/0/query?where=$3&outFields=$4&outSR=4326&orderByFields=OBJECTID&resultRecordCount=2000&f=json${5:-}" \
    -lco COORDINATE_PRECISION=5
  echo "$1: $(wc -l < "$TMP/$1.geojsonl") features"
}

fetch public Public_School_Locations_Current '1%3D1' NAME,CITY,STATE
fetch private Private_School_Locations_Current '1%3D1' NAME,CITY,STATE
# maxAllowableOffset thins the boundaries to about 20 m, a fraction of a pixel at zoom 10.
fetch districts School_Districts_Current "UNSDLEA%20IS%20NOT%20NULL%20AND%20UNSDLEA%3C%3E%27%27" \
  GEOID,NAME,LOGRADE,HIGRADE '&maxAllowableOffset=0.0002'
ogr2ogr -f GeoJSONSeq "$TMP/district_labels.geojsonl" "$TMP/districts.geojsonl" -dialect sqlite \
  -sql 'SELECT ST_PointOnSurface(geometry) AS geometry, NAME FROM districts' -lco COORDINATE_PRECISION=4

# -r1 with no feature or size limit: no school is dropped from a crowded tile.
tippecanoe -q -o "$TMP/schools.mbtiles" -Z8 -z8 -r1 --no-feature-limit --no-tile-size-limit \
  -L public:"$TMP/public.geojsonl" -L private:"$TMP/private.geojsonl"
tippecanoe -q -o "$TMP/districts.mbtiles" -Z5 -z8 --detect-shared-borders --no-tile-size-limit \
  --no-tiny-polygon-reduction -L districts:"$TMP/districts.geojsonl"
tippecanoe -q -o "$TMP/labels.mbtiles" -Z8 -z8 -r1 --no-feature-limit --no-tile-size-limit \
  -L district_labels:"$TMP/district_labels.geojsonl"
rm -f "$OUT"
tile-join -q --no-tile-size-limit -o "$OUT" "$TMP/schools.mbtiles" "$TMP/districts.mbtiles" "$TMP/labels.mbtiles"
ls -lh "$TMP"/*.mbtiles "$OUT"
