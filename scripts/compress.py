import xarray as xr
import os
import glob

fils = glob.glob("./MILES*.nc")
donefils = glob.glob("./nc_subset_compressed/*")
for fil in fils:
    head,tail = os.path.split(fil)
    if f'./nc_subset_compressed/{tail}' in donefils:
        continue
    else:
        # Open the NetCDF file
        data = xr.open_dataset(fil)

        # Create a new dataset to store rounded variables
        rounded_data = xr.Dataset()

        # Define the decimals list
        decimals = [1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 6, 0, 0, 1, 1, 1, 1, 0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0, 2, 0, 2, 0, 2, 0]
        keepvars = ["t_h","dpt_h","u_h","v_h","isobaricInhPa_h","ML_rain","ML_snow","ML_icep","ML_frzr","ML_u"]
        # Loop through data variables, round them, and store in the new dataset
        for i, var in enumerate(data.data_vars):
            if var not in keepvars:
                continue
            else:
                myvar = data[var]
                decimal = decimals[i]
                
                # Round the variable
                rounded_var = myvar.round(decimal)

                # Assign the rounded variable to the new dataset
                rounded_data[var] = rounded_var

        # Save to a new NetCDF file with compression
        new_file_path = f'./nc_subset_compressed/{tail}'
        encoding = {var: {'zlib': True, 'complevel': 4} for var in rounded_data.variables}

        rounded_data.to_netcdf(new_file_path, encoding=encoding)

        # Close the datasets
        data.close()
        rounded_data.close()
