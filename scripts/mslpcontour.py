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
        print(data.data_vars)
        lats = data['latitude'].values
        lons = data['longitude'].values - 360

        mslma = data['mslma'][0].values
        mslma = gaussian_filter(mslma, sigma=3)
        figure = plt.figure()
        ax = figure.add_subplot(111)
        contours = ax.contour(lons,lats,mslma,levels=np.arange(98800,105200,400),extend='both',cmap='Greys')
        plt.close()
        geojsoncontour.contour_to_geojson(contour=contours,geojson_filepath=f"./geojsons/{outfil}_mslp.geojson",ndigits=2)
    except:
        continue
