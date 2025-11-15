import xarray as xr
import matplotlib.pyplot as plt
import numpy as np
import geojsoncontour
import glob
from scipy.ndimage import gaussian_filter

contour_interval = 0.05

fils = glob.glob("./*.nc")
for fil in fils:
    try:
        print(fil)
        outfil = fil[:-3]
        data = xr.open_dataset(fil)

        lats = data['latitude'].values
        lons = data['longitude'].values - 360

        u = data['ML_u'][0].values
        u = gaussian_filter(u, sigma=3)

        figure = plt.figure()
        ax = figure.add_subplot(111)
        contours = ax.contour(lons,lats,u,levels=np.arange(0, 1.1, contour_interval),extend='both',cmap='Greys')
        plt.close()
        geojsoncontour.contour_to_geojson(contour=contours,geojson_filepath=f"./geojsons/{outfil}_uncertainty.geojson",ndigits=2)
    except:
        continue
