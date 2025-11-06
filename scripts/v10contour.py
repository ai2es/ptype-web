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

        v10 = data['v10'][0].values*1.94384
        v10 = gaussian_filter(v10, sigma=3)

        figure = plt.figure()
        ax = figure.add_subplot(111)
        contours = ax.contour(lons,lats,v10,levels=np.arange(-30,35,5),extend='both',cmap='Greys')
        plt.close()
        geojsoncontour.contour_to_geojson(contour=contours,geojson_filepath=f"./geojsons/{outfil}_v10.geojson",ndigits=2)
    except:
        continue
