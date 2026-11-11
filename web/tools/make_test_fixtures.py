"""Write src/testdata/fixtures.json: reference values for the JavaScript unit tests.

  python tools/make_test_fixtures.py ../backend/data/MILES_ptype_hrrr_2024-04-30_0000_f01.nc
"""
import ast
import json
import sys
from pathlib import Path

import numpy as np
import xarray as xr

sys.path.insert(0, str(Path(__file__).parent))
from make_sample_data import grid_definition  # noqa: E402

# Pull the two statistics functions out of the Flask app without importing it (it loads the model).
src = (Path(__file__).parents[2] / "backend" / "app.py").read_text()
funcs = [n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name in ("add_zero_crossings", "calc_sounding_stats")]
ns = {"np": np}
exec(compile(ast.Module(body=funcs, type_ignores=[]), "app.py", "exec"), ns)

ds = xr.open_dataset(sys.argv[1])
_, _, grid = grid_definition(ds)
rng = np.random.default_rng(1)
heights = ds.heightAboveGround.values.astype(float)
points, stats = [], []
for _ in range(40):
    j, i = int(rng.integers(ds.sizes["y"])), int(rng.integers(ds.sizes["x"]))
    lon = float(ds.longitude.values[j, i])
    points.append({"i": i, "j": j, "lat": float(ds.latitude.values[j, i]), "lon": lon - 360 if lon > 180 else lon})
    t = ds.t_h.values[0, :, j, i].astype(float)
    stats.append({"t": t.tolist(), "expected": ns["calc_sounding_stats"](t, heights)})
# A few synthetic profiles with warm noses and several crossings.
for _ in range(20):
    t = np.round(np.linspace(rng.uniform(-6, 4), -25, heights.size) + rng.uniform(0, 9) * np.exp(-0.5 * ((heights - rng.uniform(500, 2500)) / 500) ** 2), 1)
    stats.append({"t": t.tolist(), "expected": ns["calc_sounding_stats"](t, heights)})


def clean(o):
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [clean(v) for v in o]
    if isinstance(o, float) and np.isnan(o):
        return None
    return o


out = Path(__file__).parents[1] / "src" / "testdata" / "fixtures.json"
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(clean({"grid": grid, "points": points, "heights": heights.tolist(), "stats": stats})) + "\n")
print(f"Wrote {out}")
