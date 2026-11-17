"""Write the network's weights as a flat float32 file for the browser's plain-JavaScript fallback.

The viewer normally runs the ONNX model with ONNX Runtime Web (WebAssembly). Where that runtime cannot start
(seen on an iPad), it runs the same dense network in JavaScript from this file instead. The weights are read
from the ONNX file itself, so the two can never disagree.

Usage (needs onnx and numpy):
  python tools/export_weights.py public/model

Writes <dir>/ptype_model_weights.bin (W0, B0, W1, B1, ... as little-endian float32, each W row-major with
shape (inputs, outputs)) and adds "dense_layers" and "leaky_relu_alpha" to <dir>/ptype_model.json.
"""

import json
import sys
from pathlib import Path

import numpy as np
import onnx
from onnx import helper, numpy_helper


def main(model_dir: str) -> None:
    out = Path(model_dir)
    graph = onnx.load(out / "ptype_model.onnx").graph
    init = {t.name: numpy_helper.to_array(t) for t in graph.initializer}
    gemms = [n for n in graph.node if n.op_type == "Gemm"]
    alphas = {round(float(helper.get_attribute_value(a)), 6) for n in graph.node if n.op_type == "LeakyRelu" for a in n.attribute if a.name == "alpha"}
    # The fallback assumes exactly this shape of network; refuse anything else rather than write a wrong file.
    if [n.op_type for n in graph.node] != ["Gemm", "LeakyRelu"] * (len(gemms) - 1) + ["Gemm"] or len(alphas) != 1:
        raise SystemExit("ptype_model.onnx is not a plain dense network with one leaky-ReLU slope")
    if any(a.name in ("transA", "transB") and helper.get_attribute_value(a) for n in gemms for a in n.attribute):
        raise SystemExit("Gemm with transposed inputs is not supported by the fallback")
    parts, layers = [], []
    for n in gemms:
        w, b = init[n.input[1]].astype("<f4"), init[n.input[2]].astype("<f4")
        if w.ndim != 2 or b.shape != (w.shape[1],):
            raise SystemExit(f"unexpected weight shapes {w.shape} {b.shape}")
        layers.append([int(w.shape[0]), int(w.shape[1])])
        parts += [w.ravel(), b]
    blob = np.concatenate(parts)
    (out / "ptype_model_weights.bin").write_bytes(blob.tobytes())
    meta_path = out / "ptype_model.json"
    meta = json.loads(meta_path.read_text())
    meta["dense_layers"] = layers
    meta["leaky_relu_alpha"] = alphas.pop()
    meta_path.write_text(json.dumps(meta, indent=2) + "\n")
    print(f"Wrote {out / 'ptype_model_weights.bin'} ({blob.nbytes / 1e3:.0f} kB), layers {layers}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "public/model")
