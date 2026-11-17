/**
 * The evidential network in plain JavaScript: dense layers with a leaky-ReLU
 * after every layer but the last. It is the fallback for browsers where ONNX
 * Runtime's WebAssembly build cannot start, and gives the same logits (the
 * network is small: 84 inputs, five hidden layers, 145k weights).
 */
export interface DenseNet {
  /** [inputs, outputs] of each layer, first to last. */
  layers: [number, number][];
  /** W0, B0, W1, B1, ... with each W row-major as (inputs, outputs). */
  weights: Float32Array;
  /** Slope for negative activations. */
  alpha: number;
}

export function denseNetSize(layers: [number, number][]): number {
  return layers.reduce((n, [nin, nout]) => n + nin * nout + nout, 0);
}

/** Run one input vector through the network and return the output layer's raw values. */
export function denseForward(net: DenseNet, input: ArrayLike<number>): Float32Array {
  if (net.weights.length !== denseNetSize(net.layers)) throw new Error('Model weights do not match the layer sizes');
  let x = Float32Array.from(input);
  let offset = 0;
  net.layers.forEach(([nin, nout], k) => {
    if (x.length !== nin) throw new Error(`Layer ${k} expects ${nin} inputs, got ${x.length}`);
    const w = net.weights.subarray(offset, offset + nin * nout);
    const b = net.weights.subarray(offset + nin * nout, offset + nin * nout + nout);
    offset += nin * nout + nout;
    const y = new Float32Array(nout);
    for (let j = 0; j < nout; j++) {
      let sum = b[j];
      for (let i = 0; i < nin; i++) sum += x[i] * w[i * nout + j];
      y[j] = k < net.layers.length - 1 && sum < 0 ? net.alpha * sum : sum;
    }
    x = y;
  });
  return x;
}
