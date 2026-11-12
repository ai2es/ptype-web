/** Spherical Lambert conformal conic projection and regular-grid helpers. */

const D2R = Math.PI / 180;

export interface LambertParams {
  lon0: number;
  lat0: number;
  latStd: [number, number];
  radius: number;
}

/** A regular grid in projected metres. (llX, llY) is the centre of the south-west cell. */
export interface GridDef extends LambertParams {
  ni: number;
  nj: number;
  dx: number;
  dy: number;
  llX: number;
  llY: number;
}

export class Lambert {
  private readonly n: number;
  private readonly rf: number;
  private readonly rho0: number;
  private readonly lam0: number;

  constructor(readonly params: LambertParams) {
    const phi1 = params.latStd[0] * D2R;
    const phi2 = params.latStd[1] * D2R;
    const t = (phi: number) => Math.tan(Math.PI / 4 + phi / 2);
    this.n =
      Math.abs(phi1 - phi2) < 1e-10
        ? Math.sin(phi1)
        : Math.log(Math.cos(phi1) / Math.cos(phi2)) / Math.log(t(phi2) / t(phi1));
    this.rf = (params.radius * Math.cos(phi1) * Math.pow(t(phi1), this.n)) / this.n;
    this.rho0 = this.rf / Math.pow(t(params.lat0 * D2R), this.n);
    this.lam0 = params.lon0 * D2R;
  }

  /** Longitude/latitude in degrees to projected metres. */
  forward(lon: number, lat: number): [number, number] {
    let dlam = lon * D2R - this.lam0;
    while (dlam > Math.PI) dlam -= 2 * Math.PI;
    while (dlam < -Math.PI) dlam += 2 * Math.PI;
    const rho = this.rf / Math.pow(Math.tan(Math.PI / 4 + (lat * D2R) / 2), this.n);
    const theta = this.n * dlam;
    return [rho * Math.sin(theta), this.rho0 - rho * Math.cos(theta)];
  }

  /** Projected metres to longitude/latitude in degrees. */
  inverse(x: number, y: number): [number, number] {
    const dy = this.rho0 - y;
    const rho = Math.sign(this.n) * Math.hypot(x, dy);
    const theta = Math.atan2(x, dy);
    const lat = 2 * Math.atan(Math.pow(this.rf / rho, 1 / this.n)) - Math.PI / 2;
    return [(this.lam0 + theta / this.n) / D2R, lat / D2R];
  }
}

/** Nearest grid cell to a point, or null when the point is outside the grid. */
export function nearestCell(grid: GridDef, lon: number, lat: number, proj = new Lambert(grid)) {
  const [x, y] = proj.forward(lon, lat);
  const i = Math.round((x - grid.llX) / grid.dx);
  const j = Math.round((y - grid.llY) / grid.dy);
  if (i < 0 || j < 0 || i >= grid.ni || j >= grid.nj) return null;
  return { i, j, index: j * grid.ni + i };
}

/** Longitude/latitude of the centre of cell (i, j). */
export function cellLonLat(grid: GridDef, i: number, j: number, proj = new Lambert(grid)): [number, number] {
  return proj.inverse(grid.llX + i * grid.dx, grid.llY + j * grid.dy);
}

/** Read the Lambert parameters out of a PROJ string such as topozarr's `proj:code`. */
export function parseProj4Lambert(proj4: string): LambertParams {
  const kv = new Map<string, string>();
  for (const part of proj4.split(/\s+/)) {
    const m = /^\+([a-zA-Z0-9_]+)=(.*)$/.exec(part);
    if (m) kv.set(m[1], m[2]);
  }
  if (kv.get('proj') !== 'lcc') throw new Error(`Unsupported projection in "${proj4}" (expected +proj=lcc)`);
  const num = (k: string, fallback?: number) => {
    const v = kv.get(k);
    if (v === undefined) {
      if (fallback === undefined) throw new Error(`Missing +${k} in "${proj4}"`);
      return fallback;
    }
    return Number(v);
  };
  const lat1 = num('lat_1');
  return {
    lon0: num('lon_0'),
    lat0: num('lat_0', lat1),
    latStd: [lat1, num('lat_2', lat1)],
    radius: num('R', num('a', 6371229)),
  };
}
