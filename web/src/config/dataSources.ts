/**
 * Every remote location the site reads from. Override any of them at build
 * time with a VITE_* environment variable (see web/.env.example).
 */
const env = import.meta.env;

/** Resolve a site-relative path to an absolute URL (zarrita and fetch need one). */
export function siteUrl(path: string): string {
  return new URL(env.BASE_URL + path, window.location.href).href;
}

function fromEnv(value: string | undefined, fallbackPath: string): string {
  return value && value.length > 0 ? value.replace(/\/$/, '') : siteUrl(fallbackPath);
}

export const dataSources = {
  /** Root of the precipitation-type bucket; contains inits.json and one topozarr store per init. */
  get ptypeRoot() {
    return fromEnv(env.VITE_PTYPE_URL, 'sample-data/ptype');
  },
  /** Sounding Zarr store with a (init_time, forecast_hour, location, variable) array. */
  get soundingStore() {
    return fromEnv(env.VITE_SOUNDING_URL, 'sample-data/soundings.zarr');
  },
  /** ONNX export of the evidential network (S3 or a Hugging Face `resolve/main` URL). */
  get modelUrl() {
    return fromEnv(env.VITE_MODEL_URL, 'model/ptype_model.onnx');
  },
  /** Scaler and metadata that go with the model. */
  get modelMetaUrl() {
    return fromEnv(env.VITE_MODEL_META_URL, 'model/ptype_model.json');
  },
  /** NOAA's public HRRR archive (CORS-enabled, supports byte ranges). */
  hrrrRoot: (env.VITE_HRRR_URL as string | undefined) ?? 'https://noaa-hrrr-bdp-pds.s3.amazonaws.com',
};
