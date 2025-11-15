import os
os.environ["KERAS_BACKEND"] = "torch"
from flask import Flask, render_template,request,jsonify
import xarray as xr
import json
from mlguess.keras.models import CategoricalDNN
from keras.models import load_model
from bridgescaler import load_scaler
from datetime import datetime
import numpy as np
import pandas as pd

app = Flask(__name__,static_folder="")

# Nearest neighbors dictionary (rounded to nearest 0.05 deg)
# Tells which grid point to extract for every 0.05 deg increment
with open('nn.json', 'r') as json_file:
    loaded_dict = json.load(json_file)

# Load model and scaler
model = load_model("ptype_model_20240909.keras")
scaler = load_scaler("ptype_scaler_20240909.json") 
groups = scaler.groups_
input_features = [x for y in groups for x in y]
heights = np.arange(0, 5250, 250)

# Retrieve profile and predictions for chosen lat/lon + date/time
@app.route('/getCSV',methods=['GET','POST'])
def getCSV():

    # JSON data from request
    data = request.get_json()
    if data:

        # Coordinates, initialization, forecast hour
        lat = data['lat']
        lon = data['lon']
        date = data['date']
        initialization = data['initialization']
        forecasthour = data['forecastHour']

        # Format it and extract
        date_format = "%Y-%m-%dT%H:%M:%S.%fZ"
        datetime_object = datetime.strptime(date, date_format)
        year = datetime_object.year
        month = datetime_object.month
        day = datetime_object.day
        datetime_object_formatted = datetime_object.strftime("%Y-%m-%d") + "_" + initialization[:2] + "00" + "_f" + str(forecasthour).zfill(2)
        coord = f"({float(lat):.5g},{float(lon):.5g})"

        # Should change this but gets grid points of coordinates
        (x,y) = eval(loaded_dict[coord])

        # Opens relevant netcdf and gets profile at calculated grid points
        mydata = xr.open_dataset(f"data/MILES_ptype_hrrr_{datetime_object_formatted}.nc")
        agl = mydata['heightAboveGround'].values
        presreturn = mydata['isobaricInhPa_h'][0,:,x,y].values
        treturn = mydata['t_h'][0,:,x,y].values
        dptreturn = mydata['dpt_h'][0,:,x,y].values
        ureturn = mydata['u_h'][0,:,x,y].values
        vreturn = mydata['v_h'][0,:,x,y].values

        rain = mydata['ML_rain'][0,x,y].values
        snow = mydata['ML_snow'][0,x,y].values
        icep = mydata['ML_icep'][0,x,y].values
        frzr = mydata['ML_frzr'][0,x,y].values
        uncertainty = mydata['ML_u'][0,x,y].values
        rainhrrr = mydata['ML_rain'][0,x,y].values
        snowhrrr = mydata['ML_snow'][0,x,y].values
        icephrrr = mydata['ML_icep'][0,x,y].values
        frzrhrrr = mydata['ML_frzr'][0,x,y].values
        mydatasub = mydata.isel(time=0, x=y, y=x)

        # Calculate skew-T stats
        metrics = calc_sounding_stats(treturn, heights)

        mydata.close()

        # Returns data to front end
        return jsonify({"message": "Data received", "temperature": treturn.tolist(), "dewpoint": dptreturn.tolist(), "pressure": presreturn.tolist(), "rain": rain.tolist(), "snow": snow.tolist(), "icep": icep.tolist(), "frzr": frzr.tolist(), "rainhrrr": rainhrrr.tolist(), "snowhrrr": snowhrrr.tolist(), "icephrrr": icephrrr.tolist(), "frzrhrrr": frzrhrrr.tolist(), "uwind": ureturn.tolist(), "vwind": vreturn.tolist(), "metrics": metrics, "agl":agl.tolist(), "uncertainty":uncertainty.tolist()})  # Return a JSON response

    else:
        return jsonify({"error": "No data received"}), 400  # Return an error response

# Function if skew-T is modified
@app.route('/modSounding',methods=['GET','POST'])
def modSounding():

    data = request.get_json()  # Get JSON data from request
    if data:

        # Get profile from request
        temp = data['temperature']
        dpt = data['dewpoint']
        uwind = data['uwind']
        vwind = data['vwind']
        groups = scaler.groups_
        input_features = [x for y in groups for x in y]

        # Reformat and scale
        tempanddpt = np.concatenate((temp,dpt,uwind,vwind))
        tempanddpt = tempanddpt.reshape((1,84)) 
        transformed = scaler.transform(pd.DataFrame(tempanddpt, columns=input_features))
        
        # Make predictions
        pred = model.predict(transformed,return_uncertainties=True)
        probs = pred[0].numpy()[0]
        uncertainty = pred[1].numpy()[0][0]
        rain = probs[0]
        snow = probs[1]
        icep = probs[2]
        frzr = probs[3]

        # Calculate skew-T stats
        metrics = calc_sounding_stats(np.array(temp), heights)

        # Return new predictions
        return jsonify({"message": "Data received", "rain": rain.tolist(), "snow": snow.tolist(), "icep": icep.tolist(), "frzr": frzr.tolist(), "uncertainty":uncertainty.tolist(), "metrics":metrics})  # Return a JSON response

    else:
        return jsonify({"error": "No data received"}), 400  # Return an error response

# Function for sampling values from map
@app.route('/retrieveValue',methods=['GET','POST'])
def retrieveValue():
    data = request.get_json()

    if data:

        # Need coordinates and time info from request
        lat = data['lat']
        lon = data['lon']
        date = data['date']
        initialization = data['initialization']
        forecasthour = data['forecastHour']
        date_format = "%Y-%m-%dT%H:%M:%S.%fZ"
        datetime_object = datetime.strptime(date, date_format)
        year = datetime_object.year
        month = datetime_object.month
        day = datetime_object.day
        datetime_object_formatted = datetime_object.strftime("%Y-%m-%d") + "_" + initialization[:2] + "00" + "_f" + str(forecasthour).zfill(2)
        coord = f"({float(lat):.5g},{float(lon):.5g})"

        # Get gridpoints
        (x,y) = eval(loaded_dict[coord])

        # Read probabilities from netcdf
        mydata = xr.open_dataset(f"data/MILES_ptype_hrrr_{datetime_object_formatted}.nc")
        rain = mydata['ML_rain'][0,x,y].values
        snow = mydata['ML_snow'][0,x,y].values
        icep = mydata['ML_icep'][0,x,y].values
        frzr = mydata['ML_frzr'][0,x,y].values
        uncertainty = mydata['ML_u'][0,x,y].values
        mydata.close()

        # Return probabilities
        return jsonify({"message": "Data received", "rain": rain.tolist(), "snow": snow.tolist(), "icep": icep.tolist(), "frzr": frzr.tolist(), "uncertainty": uncertainty.tolist()})

# Calculate skew-T stats
def add_zero_crossings(profile, heights):
    pre_crossing_level = np.argwhere((np.diff(np.sign(profile)) != 0) * 1).flatten()
    post_crossing_level = pre_crossing_level + 1
    indices = []
    crossings_m = []
    for pre, post in zip(pre_crossing_level, post_crossing_level):
        xp = profile[pre:post + 1]
        fp = heights[pre:post + 1]
        if xp[0] > xp[1]:
            xp = xp[::-1]
            fp = fp[::-1]
        crossings_m.append(np.interp(0, xp, fp))
        indices.append(post)
    profile = np.insert(profile, indices, 0)
    heights = np.insert(heights, indices, crossings_m)

    return profile, heights


def calc_sounding_stats(profile, height_interp):
    FREEZING_K = 273.15
    GRAVITY = 9.81

    cold_area, warm_area = [], []
    low_i, cold_thickness, warm_thickness = 0, 0, 0
    surface = profile[0]
    profile, heights = add_zero_crossings(profile, height_interp)
    try:
        upper_bound_index = np.argwhere(
            profile == 0).max() + 1  # get index of highest crossing where we no longer care about
        lower_bound_index = np.argwhere(profile == 0).min()
        highest_crossing = heights[upper_bound_index - 1]
        lowest_crossing = heights[lower_bound_index]
    except:
        min_cold, max_warm, t_span, highest_crossing, lowest_crossing = np.nan, np.nan, np.nan, np.nan, np.nan
        metrics = dict(cold_area=int(np.abs(np.sum(cold_area))),
                       warm_area=int(np.sum(warm_area)),
                       cold_thickness=int(cold_thickness),
                       warm_thickness=int(warm_thickness),
                       min_cold=round(float(min_cold), 3),
                       max_warm=round(float(max_warm), 3),
                       highest_crossing=round(float(highest_crossing), 3),
                       lowest_crossing=round(float(lowest_crossing), 3),
                       surface_temp=round(float(surface), 3))

        return metrics

    min_cold = profile[:upper_bound_index].min()
    max_warm = profile[:upper_bound_index].max()
    for i in range(upper_bound_index):
        if (profile[i] == 0):

            energy = np.trapezoid(GRAVITY * (profile[low_i:i + 1] / FREEZING_K), heights[low_i:i + 1])
            if energy <= 0:
                cold_area.append(energy)
                cold_thickness += heights[i] - heights[low_i]
            else:
                warm_area.append(energy)
                warm_thickness += heights[i] - heights[low_i]
            low_i = i
        metrics = dict(cold_area=int(np.abs(np.sum(cold_area))),
                       warm_area=int(np.sum(warm_area)),
                       cold_thickness=int(cold_thickness),
                       warm_thickness=int(warm_thickness),
                       min_cold=round(float(min_cold), 3),
                       max_warm=round(float(max_warm), 3),
                       highest_crossing=round(float(highest_crossing), 3),
                       lowest_crossing=round(float(lowest_crossing), 3),
                       surface_temp=round(float(surface), 3))
    return metrics


if __name__ == "__main__":
    app.run(debug=True, threaded=True)
