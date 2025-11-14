import xarray as xr
import numpy as np
import glob
from scipy.ndimage import gaussian_filter
from skimage import measure
from shapely.geometry import LineString, Polygon, MultiPolygon
import json
from scipy.ndimage import map_coordinates
from shapely.ops import unary_union

contour_interval = 0.05

def mask_to_geo_polygon(mask, lons, lats):

    ny, nx = mask.shape

    # Create corner index grid at half offsets
    ii = np.arange(-0.5, ny+0.5)
    jj = np.arange(-0.5, nx+0.5)
    I, J = np.meshgrid(ii, jj, indexing='ij')

    # Interpolate lon/lat at cell corners
    lon_c = map_coordinates(lons, [I, J], order=1, mode='nearest')
    lat_c = map_coordinates(lats, [I, J], order=1, mode='nearest')

    # Build a polygon for each True cell
    cells_i, cells_j = np.where(mask)

    polys = []
    for i, j in zip(cells_i, cells_j):
        p = Polygon([
            (lon_c[i,   j  ], lat_c[i,   j  ]),
            (lon_c[i,   j+1], lat_c[i,   j+1]),
            (lon_c[i+1, j+1], lat_c[i+1, j+1]),
            (lon_c[i+1, j  ], lat_c[i+1, j  ]),
        ])
        if p.is_valid and not p.is_empty:
            polys.append(p)

    return unary_union(MultiPolygon(polys))


def clipped_contours_to_geojson(clipped_segments, filepath):
    """ Write geojson out for masked contours """
    features = []
    for level, seg in clipped_segments:
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": seg.tolist()
            },
            "properties": {
                "contour_level": float(level),
                'level-index': int(level * 10),
                  'level-value': level,
                  # 'stroke': '#b5b5b5',
                  'stroke': 'k',
                  'stroke-width': 1,
                  'title': str(f"{level:.2f}")
            }
        })

    geojson = {"type": "FeatureCollection", "features": features}

    with open(filepath, "w") as f:
        json.dump(geojson, f, indent=2)

#####################################

#
fils = glob.glob("./*.nc")
for fil in fils:
    try:
        print(fil)
        outfil = fil[:-3]
        data = xr.open_dataset(fil, decode_timedelta=False)
        levels = np.arange(0, 1.1, contour_interval)
        lats = data['latitude'].values
        lons = data['longitude'].values - 360
        clipped_segments = []

        u = data['ML_u'][0].values
        u = gaussian_filter(u, sigma=3)

        rainhrrr = data['crain'][0].values
        snowhrrr = data['csnow'][0].values
        icephrrr = data['cicep'][0].values
        frzrhrrr = data['cfrzr'][0].values

        mask = np.logical_or.reduce((rainhrrr != 0, snowhrrr != 0, icephrrr != 0, frzrhrrr != 0))
        u[~mask] = np.nan
        mask_poly = mask_to_geo_polygon(mask, lons, lats).simplify(0.01, preserve_topology=True)

        for level in levels:
            contours = measure.find_contours(u, level)

            for c in contours:
                rr, cc = c[:, 0], c[:, 1]

                lonv = map_coordinates(lons, [rr, cc], order=1)
                latv = map_coordinates(lats, [rr, cc], order=1)

                line = LineString(np.column_stack([lonv, latv]))
                inter = line.intersection(mask_poly)

                if inter.is_empty:
                    continue

                # store line + level
                if inter.geom_type == "LineString":
                    clipped_segments.append((round(level, 2), np.asarray(inter.coords)))
                elif inter.geom_type == "MultiLineString":
                    for seg in inter.geoms:
                        clipped_segments.append((round(level, 2), np.asarray(seg.coords)))


        clipped_contours_to_geojson(clipped_segments, outfil)

    except Exception as e:
        print("Error:", e)
        continue
