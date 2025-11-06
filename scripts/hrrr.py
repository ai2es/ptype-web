import xarray as xr
import matplotlib.pyplot as plt
import numpy as np
import geojsoncontour
import glob
from multiprocessing import Pool

def process_file(fil):
    try:
        outfil = fil[:-3]
        data = xr.open_dataset(fil)
        print(data.data_vars)
        lats = data['latitude'].values
        lons = data['longitude'].values - 360

        variables = {
            'rain': {'data': data['crain'][0].values.astype('float'), 'color': '#005321', 'suffix': '_hrrr_rain.geojson'},
            'snow': {'data': data['csnow'][0].values.astype('float'), 'color': '#0A3C7D', 'suffix': '_hrrr_snow.geojson'},
            'icep': {'data': data['cicep'][0].values.astype('float'), 'color': '#7E0611', 'suffix': '_hrrr_icep.geojson'},
            'frzr': {'data': data['cfrzr'][0].values.astype('float'), 'color': '#330C61', 'suffix': '_hrrr_frzr.geojson'}
        }

        for var, attrs in variables.items():
            figure = plt.figure()
            ax = figure.add_subplot(111)
            contours = ax.contourf(lons, lats, attrs['data'], levels=[.5, 1], colors=[attrs['color']], extend='max')
            plt.close()
            geojsoncontour.contourf_to_geojson(
                contourf=contours,
                geojson_filepath=f"./geojsons/{outfil}{attrs['suffix']}",
                ndigits=2
            )
    except:
        pass

def main():
    fils = glob.glob("./*.nc")
    # Using a pool of 8 processes
    with Pool(processes=8) as pool:
        pool.map(process_file, fils)

if __name__ == "__main__":
    main()
   
