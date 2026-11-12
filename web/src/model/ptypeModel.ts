/** Runs the evidential network in the browser with ONNX Runtime Web (WASM). */
import type { InferenceSession } from 'onnxruntime-web/wasm';
import { dataSources } from '../config/dataSources';
import type { Profile } from '../sounding/profile';
import { buildInput, dirichlet, type ModelMeta, type Prediction } from './evidential';

interface Loaded {
  ort: typeof import('onnxruntime-web/wasm');
  session: InferenceSession;
  meta: ModelMeta;
}

let loading: Promise<Loaded> | null = null;

async function load(): Promise<Loaded> {
  // Loaded lazily so the runtime is only downloaded when a sounding is opened.
  const [ort, wasmUrl, metaResp] = await Promise.all([
    import('onnxruntime-web/wasm'),
    import('onnxruntime-web/ort-wasm-simd-threaded.wasm?url'),
    fetch(dataSources.modelMetaUrl),
  ]);
  if (!metaResp.ok) throw new Error(`Could not load model metadata (${metaResp.status})`);
  const meta = (await metaResp.json()) as ModelMeta;
  ort.env.wasm.numThreads = 1; // no cross-origin isolation on GitHub Pages
  ort.env.wasm.wasmPaths = { wasm: wasmUrl.default };
  const session = await ort.InferenceSession.create(dataSources.modelUrl, { executionProviders: ['wasm'] });
  return { ort, session, meta };
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
  const { ort, session, meta } = await loadModel();
  const input = new ort.Tensor('float32', buildInput(profile, meta), [1, meta.heights_m.length * 4]);
  const out = await session.run({ [session.inputNames[0]]: input });
  return dirichlet(out[session.outputNames[0]].data as Float32Array);
}
