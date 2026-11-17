/** Runs the evidential network in the browser with ONNX Runtime Web (WASM). */
import { dataSources } from '../config/dataSources';
import type { Profile } from '../sounding/profile';
import { denseForward, denseNetSize, type DenseNet } from './denseNet';
import { buildInput, dirichlet, type ModelMeta, type Prediction } from './evidential';

interface Loaded {
  meta: ModelMeta;
  /** Scaled inputs to the network's raw outputs. */
  run(input: Float32Array): Promise<ArrayLike<number>>;
  /** Which engine is in use, for the console. */
  engine: 'onnxruntime' | 'javascript';
}

let loading: Promise<Loaded> | null = null;

async function loadOnnx(meta: ModelMeta): Promise<Loaded> {
  const [ort, wasmUrl] = await Promise.all([import('onnxruntime-web/wasm'), import('onnxruntime-web/ort-wasm-simd-threaded.wasm?url')]);
  ort.env.wasm.numThreads = 1; // no cross-origin isolation on GitHub Pages
  ort.env.wasm.wasmPaths = { wasm: wasmUrl.default };
  const session = await ort.InferenceSession.create(dataSources.modelUrl, { executionProviders: ['wasm'] });
  return {
    meta,
    engine: 'onnxruntime',
    run: async (input) => {
      const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, input.length]) });
      return out[session.outputNames[0]].data as Float32Array;
    },
  };
}

/** The same network without WebAssembly, from the weights file that sits next to the ONNX model. */
async function loadJavaScript(meta: ModelMeta): Promise<Loaded> {
  if (!meta.dense_layers || meta.leaky_relu_alpha === undefined) throw new Error('Model metadata has no dense_layers for the fallback');
  const resp = await fetch(dataSources.modelUrl.replace(/\.onnx$/, '_weights.bin'));
  if (!resp.ok) throw new Error(`Could not load model weights (${resp.status})`);
  const net: DenseNet = { layers: meta.dense_layers, alpha: meta.leaky_relu_alpha, weights: new Float32Array(await resp.arrayBuffer()) };
  if (net.weights.length !== denseNetSize(net.layers)) throw new Error('Model weights file has the wrong size');
  return { meta, engine: 'javascript', run: async (input) => denseForward(net, input) };
}

async function load(): Promise<Loaded> {
  // Loaded lazily so the runtime is only downloaded when a sounding is opened.
  const metaResp = await fetch(dataSources.modelMetaUrl);
  if (!metaResp.ok) throw new Error(`Could not load model metadata (${metaResp.status})`);
  const meta = (await metaResp.json()) as ModelMeta;
  try {
    return await loadOnnx(meta);
  } catch (err) {
    // ONNX Runtime's WebAssembly build did not start (reported on an iPad). The network is small enough to
    // run directly, so the panel still works; the reason is logged for whoever is debugging.
    console.warn('ONNX Runtime could not start; running the network in JavaScript instead.', err);
    return loadJavaScript(meta);
  }
}

export function loadModel(): Promise<Loaded> {
  if (!loading) {
    loading = load().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

export async function predict(profile: Profile): Promise<Prediction> {
  const { run, meta } = await loadModel();
  return dirichlet(await run(buildInput(profile, meta)));
}
