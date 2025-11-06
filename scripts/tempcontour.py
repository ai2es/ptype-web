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

        t2 = data['t2m'][0].values - 273.15
        t2 = gaussian_filter(t2, sigma=3)

        figure = plt.figure()
        ax = figure.add_subplot(111)
        contours = ax.contour(lons,lats,t2,levels=np.arange(-30,25,5),extend='both',cmap='Greys')
        plt.close()
        geojsoncontour.contour_to_geojson(contour=contours,geojson_filepath=f"./geojsons/{outfil}_temp.geojson",ndigits=2)
    except:
        continue
