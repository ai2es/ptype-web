import xarray as xr
import matplotlib.pyplot as plt
import numpy as np
import geojsoncontour
import glob
from scipy.ndimage import gaussian_filter

fils = glob.glob("./*.nc")
for fil in fils:
    try:
        outfil = fil[:-3]
        data = xr.open_dataset(fil)
        
        lats = data['latitude'].values
        lons = data['longitude'].values - 360

        u10 = data['u10'][0].values*1.94384
        u10 = gaussian_filter(u10, sigma=3)

        figure = plt.figure()
        ax = figure.add_subplot(111)
        contours = ax.contour(lons,lats,u10,levels=np.arange(-30,35,5),extend='both',cmap='Greys')
        plt.close()
        geojsoncontour.contour_to_geojson(contour=contours,geojson_filepath=f"./geojsons/{outfil}_u10.geojson",ndigits=2)
    except:
        continue
