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
        metrics = calc_profile_metrics(treturn)

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
        metrics = calc_profile_metrics(np.array(temp))

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
def calc_profile_metrics(x, profile_var='t_h', resolution=250):
    """ Given a vertical temperature profile, return area energy using the  
    Bourgouin area method estimated with the trapezoidal method. 

    Args:
        ds (xr.Dataset): xarray dataset of the vertical profile of a single spatial point
        profile_var (str): The name of the variable to use for calculations
        resolution (int): Vertical spatial resolution of profile in meters. 
    Returns:
        Dict: Dictionary of statistics for elevated cold / warm layers
    """
    hgts = np.array([0,250,500,750,1000,1250,1500,1750,2000,2250,2500,2750,3000,3250,3500,3750,4000,4250,4500,4750,5000])

    metrics = {}
    warm = np.argwhere(x > 0).squeeze()    

    # Check for warm nose
    if warm.size == 0:
        metrics['upper_nose_height_agl'] = 'N/A'
        metrics['lower_nose_height_agl'] = 'N/A'
        metrics['warm_nose_depth_m'] = 'N/A'
        metrics['warm_nose_area'] = 'N/A'
        metrics['cold_layer_depth_m'] = 'N/A'
        metrics['cold_layer_area'] = 'N/A'
    else:
        cold = np.argwhere(np.where(x < 0)[0] < warm.min()).squeeze()
        if cold.size == 0:
            metrics['upper_nose_height_agl'] = 'N/A'
            metrics['lower_nose_height_agl'] = 'N/A'
            metrics['warm_nose_depth_m'] = 'N/A'
            metrics['warm_nose_area'] = 'N/A'
            metrics['cold_layer_depth_m'] = 'N/A'
            metrics['cold_layer_area'] = 'N/A' 
        else:
            print(warm)
            top_nose = warm.max()
            bottom_nose = warm.min()
            warm_nose_depth = (top_nose - bottom_nose) * resolution
            metrics['upper_nose_height_agl'] = str(hgts[top_nose])
            metrics['lower_nose_height_agl'] = str(hgts[bottom_nose])
            metrics['warm_nose_depth_m'] = str(int(warm_nose_depth))
            metrics['warm_nose_area'] = str(int(np.abs(np.trapz(x[warm], dx=len(warm) * resolution))))
            top_cold = cold.max()
            bottom_cold = cold.min()
            cold_layer_depth = str(int((top_cold - bottom_cold) * resolution))
            metrics['cold_layer_depth_m'] = str(int(cold_layer_depth))
            metrics['cold_layer_area'] = str(int(np.abs(np.trapz(x[cold], dx=len(cold) * resolution))))

    return metrics


if __name__ == "__main__":
    app.run(debug=True, threaded=True)
