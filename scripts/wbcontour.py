import xarray as xr
import matplotlib.pyplot as plt
import numpy as np
import geojsoncontour
import glob
from scipy.ndimage import gaussian_filter
from metpy.calc import wet_bulb_temperature
from metpy.calc import relative_humidity_from_dewpoint
from metpy.units import units

fils = glob.glob("./*.nc")
for fil in fils:
    try:
        print(fil)
        outfil = fil[:-3]
        data = xr.open_dataset(fil)

        lats = data['latitude'].values
        lons = data['longitude'].values - 360

        t2 = data['t2m'][0].values - 273.15
        d2 = data['d2m'][0].values - 273.15
        rh = np.array(relative_humidity_from_dewpoint(t2 * units.degC, d2 * units.degC))*100

        wb = t2 * np.arctan(0.151977 * (rh + 8.313659)**0.5) + np.arctan(t2 + rh) - np.arctan(rh - 1.676331) + 0.00391838*(rh)**(3/2.)*np.arctan(0.023101*rh) - 4.686035
        
        wb = gaussian_filter(wb, sigma=3)

        figure = plt.figure()
        ax = figure.add_subplot(111)
        contours = ax.contour(lons,lats,wb,levels=np.arange(-30,25,5),extend='both',cmap='Greys')
        plt.close()
        geojsoncontour.contour_to_geojson(contour=contours,geojson_filepath=f"./geojsons/{outfil}_wb.geojson",ndigits=2)
    except:
        continue
