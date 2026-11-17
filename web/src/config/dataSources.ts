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

/**
 * The S3 bucket the forecasts are published to. Its policy only answers
 * requests whose Referer is this site (or a localhost dev server), which the
 * browser sends by itself; no key or signing is involved.
 */
export const FORECAST_BUCKET = 'https://wwe-ptype.s3.us-east-1.amazonaws.com';

/** An override may be an absolute URL or a path inside the site (e.g. `sample-data/ptype`). */
function remote(value: string | undefined, fallbackUrl: string): string {
  if (!value || value.length === 0) return fallbackUrl;
  const trimmed = value.replace(/\/$/, '');
  return /^https?:/.test(trimmed) ? trimmed : siteUrl(trimmed);
}

export const dataSources = {
  /** Holds inits.json and one topozarr store per run (paths in inits.json are relative to this). */
  get ptypeRoot() {
    return remote(env.VITE_PTYPE_URL, `${FORECAST_BUCKET}/ptype`);
  },
  /**
   * Root that the `soundings` paths in inits.json are relative to: one sounding
   * store per run. An override ending in `.zarr` is used as the single store
   * for every run (the layout of the bundled sample data).
   */
  get soundingRoot() {
    return remote(env.VITE_SOUNDING_URL, FORECAST_BUCKET);
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
