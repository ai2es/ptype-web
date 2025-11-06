import xarray as xr
import matplotlib.pyplot as plt
import numpy as np
import geojsoncontour
import glob
from scipy.ndimage import gaussian_filter

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

        rainhrrr = data['crain'][0].values
        snowhrrr = data['csnow'][0].values
        icephrrr = data['cicep'][0].values
        frzrhrrr = data['cfrzr'][0].values

        mask = np.logical_or.reduce((rainhrrr != 0, snowhrrr != 0, icephrrr != 0, frzrhrrr != 0))

        # Set non-maximum values to zero
        u[~mask] = np.nan

        figure = plt.figure()
        ax = figure.add_subplot(111)
        contours = ax.contour(lons,lats,u,levels=np.arange(0,1.1,0.1),extend='both',cmap='Greys')
        plt.close()
        geojsoncontour.contour_to_geojson(contour=contours,geojson_filepath=f"./geojsons/{outfil}_uncertainty.geojson",ndigits=2)
    except:
        continue
