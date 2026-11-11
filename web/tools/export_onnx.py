"""Export the evidential precipitation-type network to ONNX for the web app.

Reads the Keras model and bridgescaler JSON, writes
  <out>/ptype_model.onnx   raw network (scaled inputs -> evidential logits)
  <out>/ptype_model.json   scaler constants, input layout and class order
and a fixtures file used by the JavaScript parity test.

Usage (needs keras, torch, miles-guess, bridgescaler, onnx, onnxruntime):
  KERAS_BACKEND=torch python tools/export_onnx.py \
      --model ../backend/ptype_model_20240909.keras \
      --scaler ../backend/ptype_scaler_20240909.json \
      --out public/model --fixtures src/model/fixtures.json
"""
import argparse
import json
import os
from pathlib import Path

os.environ.setdefault("KERAS_BACKEND", "torch")

import numpy as np
import onnx
import onnxruntime as ort
from onnx import TensorProto, helper, numpy_helper

CLASSES = ["rain", "snow", "icep", "frzr"]
HEIGHTS_M = list(range(0, 5250, 250))
GROUPS = ["temperature_c", "dewpoint_c", "u_ms", "v_ms"]


def load_keras(path):
    from keras.models import load_model
    from mlguess.keras.losses import evidential_cat_loss
    from mlguess.keras.models import CategoricalDNN  # noqa: F401  (registers the class)
    import mlguess.keras.callbacks  # noqa: F401

    return load_model(path, custom_objects={"loss": evidential_cat_loss})


def build_onnx(model):
    """Rebuild the dense stack as Gemm/LeakyRelu nodes (dropout is inactive at inference)."""
    nodes, inits = [], []
    prev = "input"
    dense = [l for l in model.layers if type(l).__name__ == "Dense"]
    for i, layer in enumerate(dense):
        kernel, bias = [np.asarray(w, dtype=np.float32) for w in layer.get_weights()]
        inits.append(numpy_helper.from_array(kernel, f"W{i}"))
        inits.append(numpy_helper.from_array(bias, f"B{i}"))
        act = layer.activation.__name__
        last = i == len(dense) - 1
        gemm_out = "output" if (last and act == "linear") else f"z{i}"
        nodes.append(helper.make_node("Gemm", [prev, f"W{i}", f"B{i}"], [gemm_out]))
        if act == "leaky_relu":
            out = "output" if last else f"a{i}"
            # keras.activations.leaky_relu default negative_slope
            nodes.append(helper.make_node("LeakyRelu", [gemm_out], [out], alpha=0.2))
            prev = out
        elif act == "linear":
            prev = gemm_out
        else:
            raise ValueError(f"Unsupported activation {act!r} in layer {layer.name}")
    n_in = dense[0].get_weights()[0].shape[0]
    n_out = dense[-1].get_weights()[0].shape[1]
    graph = helper.make_graph(
        nodes,
        "ptype_evidential_dnn",
        [helper.make_tensor_value_info("input", TensorProto.FLOAT, ["batch", n_in])],
        [helper.make_tensor_value_info("output", TensorProto.FLOAT, ["batch", n_out])],
        inits,
    )
    onnx_model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    onnx_model.ir_version = 9
    onnx.checker.check_model(onnx_model)
    return onnx_model


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--model", required=True)
    p.add_argument("--scaler", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--fixtures", default=None)
    p.add_argument("--sample-nc", default=None, help="MILES netCDF to draw realistic fixture soundings from")
    args = p.parse_args()

    from bridgescaler import load_scaler

    model = load_keras(args.model)
    scaler = load_scaler(args.scaler)
    center = np.asarray(scaler.center_, dtype=np.float64).ravel()
    scale = np.asarray(scaler.scale_, dtype=np.float64).ravel()
    assert center.size == len(GROUPS) and scale.size == len(GROUPS)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    onnx_model = build_onnx(model)
    onnx.save(onnx_model, out / "ptype_model.onnx")

    meta = {
        "source_model": Path(args.model).name,
        "classes": CLASSES,
        "heights_m": HEIGHTS_M,
        "input_groups": GROUPS,
        "input_layout": "concatenate(groups), each group ordered surface to 5000 m",
        "scaler": {"type": "GroupRobustScaler", "center": center.tolist(), "scale": scale.tolist()},
        "evidential": {"alpha": "relu(output) + 1", "prob": "alpha / sum(alpha)", "u": "n_classes / sum(alpha)"},
    }
    (out / "ptype_model.json").write_text(json.dumps(meta, indent=2) + "\n")

    # Fixtures: raw soundings -> Keras probabilities and u.
    rng = np.random.default_rng(0)
    n_lev = len(HEIGHTS_M)
    raw = []
    if args.sample_nc:
        import xarray as xr

        ds = xr.open_dataset(args.sample_nc)
        ny, nx = ds.sizes["y"], ds.sizes["x"]
        for _ in range(24):
            j, i = int(rng.integers(ny)), int(rng.integers(nx))
            raw.append(np.concatenate([ds[v].values[0, :, j, i] for v in ("t_h", "dpt_h", "u_h", "v_h")]))
    for _ in range(8):
        t = np.linspace(rng.uniform(-10, 8), rng.uniform(-30, -5), n_lev) + rng.normal(0, 2, n_lev)
        raw.append(np.concatenate([t, t - rng.uniform(0, 6, n_lev), rng.normal(5, 8, n_lev), rng.normal(2, 8, n_lev)]))
    raw = np.asarray(raw, dtype=np.float32)
    group_index = np.repeat(np.arange(len(GROUPS)), n_lev)
    scaled = ((raw - center[group_index]) / scale[group_index]).astype(np.float32)

    prob, u, _, _ = model.predict(scaled, return_uncertainties=True, verbose=0)
    prob = np.asarray(prob.cpu() if hasattr(prob, "cpu") else prob)
    u = np.asarray(u.cpu() if hasattr(u, "cpu") else u).ravel()

    sess = ort.InferenceSession(str(out / "ptype_model.onnx"))
    logits = sess.run(None, {"input": scaled})[0]
    alpha = np.maximum(logits, 0) + 1
    s = alpha.sum(axis=1, keepdims=True)
    err = float(np.abs(alpha / s - prob).max())
    err_u = float(np.abs(4 / s.ravel() - u).max())
    print(f"ONNX vs Keras: max |dprob| = {err:.2e}, max |du| = {err_u:.2e}")
    assert err < 1e-4 and err_u < 1e-4, "ONNX export does not match Keras"

    if args.fixtures:
        fx = {"inputs": np.round(raw, 4).tolist(), "prob": prob.tolist(), "u": u.tolist()}
        # Re-run on the rounded inputs so the stored outputs match the stored inputs exactly.
        rr = np.asarray(fx["inputs"], dtype=np.float32)
        ss = ((rr - center[group_index]) / scale[group_index]).astype(np.float32)
        pr, uu, _, _ = model.predict(ss, return_uncertainties=True, verbose=0)
        fx["prob"] = np.asarray(pr.cpu() if hasattr(pr, "cpu") else pr).tolist()
        fx["u"] = np.asarray(uu.cpu() if hasattr(uu, "cpu") else uu).ravel().tolist()
        fx["logits"] = sess.run(None, {"input": ss})[0].tolist()
        Path(args.fixtures).write_text(json.dumps(fx) + "\n")
    print(f"Wrote {out / 'ptype_model.onnx'} ({(out / 'ptype_model.onnx').stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
