import xarray as xr
import matplotlib.pyplot as plt
import numpy as np
import geojsoncontour
import glob

fils = glob.glob("./*.nc")
fils.sort()
for fil in fils:
    try:
        outfil = fil[:-3]
        data = xr.open_dataset(fil)
        lats = data['latitude'].values
        lons = data['longitude'].values

        rain = data['ML_rain'][0].values
        snow = data['ML_snow'][0].values
        icep = data['ML_icep'][0].values
        frzr = data['ML_frzr'][0].values

        rainhrrr = data['crain'][0].values
        snowhrrr = data['csnow'][0].values
        icephrrr = data['cicep'][0].values
        frzrhrrr = data['cfrzr'][0].values

        mask = np.logical_or.reduce((rainhrrr != 0, snowhrrr != 0, icephrrr != 0, frzrhrrr != 0))
        max_values = np.maximum(np.maximum(rain, snow), np.maximum(icep, frzr))

        rain_mask = (rain == max_values)
        snow_mask = (snow == max_values)
        icep_mask = (icep == max_values)
        frzr_mask = (frzr == max_values)

        # Set non-maximum values to zero
        rain[~rain_mask] = np.nan
        snow[~snow_mask] = np.nan
        icep[~icep_mask] = np.nan
        frzr[~frzr_mask] = np.nan
        rain[~mask] = np.nan
        snow[~mask] = np.nan
        icep[~mask] = np.nan
        frzr[~mask] = np.nan

        figure = plt.figure()
        ax = figure.add_subplot(111)
        contours = ax.contourf(lons,lats,rain,levels=np.arange(0,1.1,.1),extend='both',cmap='Greens')
        plt.close()
        geojsoncontour.contourf_to_geojson(contourf=contours,geojson_filepath=f"./evi_rain/{outfil}_rain.geojson",ndigits=2)

        figure = plt.figure()
        ax = figure.add_subplot(111)
        contours = ax.contourf(lons,lats,snow,levels=np.arange(0,1.1,.1),extend='both',cmap='Blues')
        plt.close()
        geojsoncontour.contourf_to_geojson(contourf=contours,geojson_filepath=f"./evi_snow/{outfil}_snow.geojson",ndigits=2)

        figure = plt.figure()
        ax = figure.add_subplot(111)
        contours = ax.contourf(lons,lats,icep,levels=np.arange(0,1.1,.1),extend='both',cmap='Purples')
        plt.close()
        geojsoncontour.contourf_to_geojson(contourf=contours,geojson_filepath=f"./evi_icep/{outfil}_icep.geojson",ndigits=2)

        figure = plt.figure()
        ax = figure.add_subplot(111)
        contours = ax.contourf(lons,lats,frzr,levels=np.arange(0,1.1,.1),extend='both',cmap='Reds')
        plt.close()
        geojsoncontour.contourf_to_geojson(contourf=contours,geojson_filepath=f"./evi_frzr/{outfil}_frzr.geojson",ndigits=2)
    except:
        print("error",fil)
        continue
