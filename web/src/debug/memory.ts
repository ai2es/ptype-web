/**
 * Memory probe, switched on with `?memdebug` in the URL. It answers "what is
 * holding memory right now": the size of every cache the site keeps, and the
 * graphics-card buffers and textures that are still alive.
 *
 * Graphics memory is invisible to the JavaScript heap figures, so the WebGL
 * calls that allocate and free it are wrapped and the live bytes counted. A
 * buffer or texture counts as live until it is deleted or its JavaScript handle
 * is garbage collected (a FinalizationRegistry reports the latter).
 *
 * Call `ptypeMemory()` in the console for a snapshot.
 */
import { hrrrCacheStats } from '../data/hrrr';
import { ptypeCacheStats } from '../data/ptype';
import { maskCacheStats } from '../map/reflectivityMask';

interface GlStats {
  bufferBytes: number;
  buffers: number;
  textureBytes: number;
  textures: number;
  /** Bytes released by an explicit delete call, and by garbage collection of the handle. */
  deletedBytes: number;
  collectedBytes: number;
}

const gl: GlStats = { bufferBytes: 0, buffers: 0, textureBytes: 0, textures: 0, deletedBytes: 0, collectedBytes: 0 };
/** Extra readers registered by objects that only exist once the map does (the layer manager). */
const extra = new Map<string, () => unknown>();

export function registerMemoryStats(name: string, read: () => unknown): void {
  extra.set(name, read);
}

const BYTES_PER_TEXEL: Record<number, number> = { 0x822d: 2, 0x822e: 4, 0x8229: 1, 0x1909: 1, 0x1906: 1, 0x8814: 16, 0x881a: 8 };

function installGlTracker(): void {
  type Kind = 'buffer' | 'texture';
  interface Rec { kind: Kind; bytes: number; live: boolean }
  const recs = new WeakMap<object, Rec>();
  const add = (rec: Rec, bytes: number) => {
    if (!rec.live) return;
    const d = bytes - rec.bytes;
    rec.bytes = bytes;
    if (rec.kind === 'buffer') gl.bufferBytes += d;
    else gl.textureBytes += d;
  };
  const free = (rec: Rec, how: 'deletedBytes' | 'collectedBytes') => {
    if (!rec.live) return;
    gl[how] += rec.bytes;
    add(rec, 0);
    rec.live = false;
    if (rec.kind === 'buffer') gl.buffers--;
    else gl.textures--;
  };
  const registry = new FinalizationRegistry<Rec>((rec) => free(rec, 'collectedBytes'));
  const P = WebGL2RenderingContext.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const wrap = (name: string, around: (orig: (...a: unknown[]) => unknown, self: WebGL2RenderingContext, args: unknown[]) => unknown) => {
    const orig = P[name];
    P[name] = function (this: WebGL2RenderingContext, ...args: unknown[]) {
      return around(orig, this, args);
    };
  };
  const create = (kind: Kind) => (orig: (...a: unknown[]) => unknown, self: WebGL2RenderingContext, args: unknown[]) => {
    const obj = orig.apply(self, args) as object | null;
    if (obj) {
      const rec: Rec = { kind, bytes: 0, live: true };
      recs.set(obj, rec);
      registry.register(obj, rec);
      if (kind === 'buffer') gl.buffers++;
      else gl.textures++;
    }
    return obj;
  };
  const destroy = (orig: (...a: unknown[]) => unknown, self: WebGL2RenderingContext, args: unknown[]) => {
    const rec = args[0] ? recs.get(args[0] as object) : undefined;
    if (rec) free(rec, 'deletedBytes');
    return orig.apply(self, args);
  };
  wrap('createBuffer', create('buffer'));
  wrap('createTexture', create('texture'));
  wrap('deleteBuffer', destroy);
  wrap('deleteTexture', destroy);
  wrap('bufferData', (orig, self, args) => {
    const bound = self.getParameter(args[0] === self.ELEMENT_ARRAY_BUFFER ? self.ELEMENT_ARRAY_BUFFER_BINDING : self.ARRAY_BUFFER_BINDING) as object | null;
    const rec = bound ? recs.get(bound) : undefined;
    const src = args[1];
    if (rec) add(rec, typeof src === 'number' ? src : ((src as ArrayBufferView | null)?.byteLength ?? 0));
    return orig.apply(self, args);
  });
  wrap('texImage2D', (orig, self, args) => {
    // Only level 0 of 2D textures is counted; (target, level, internalformat, width, height, ...) or the 6-argument image form.
    if (args[0] === self.TEXTURE_2D && args[1] === 0) {
      const rec = recs.get(self.getParameter(self.TEXTURE_BINDING_2D) as object);
      let w = 0;
      let h = 0;
      if (args.length >= 9) [w, h] = [args[3] as number, args[4] as number];
      else {
        const img = args[5] as { width?: number; height?: number } | null;
        [w, h] = [img?.width ?? 0, img?.height ?? 0];
      }
      if (rec) add(rec, w * h * (BYTES_PER_TEXEL[args[2] as number] ?? 4));
    }
    return orig.apply(self, args);
  });
}

function snapshot() {
  const mb = (n: number) => Math.round((n / 1048576) * 10) / 10;
  const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  const out: Record<string, unknown> = {
    hrrr: hrrrCacheStats(),
    ptype: ptypeCacheStats(),
    masks: maskCacheStats(),
    gpuMB: {
      buffers: mb(gl.bufferBytes), nBuffers: gl.buffers, textures: mb(gl.textureBytes), nTextures: gl.textures,
      freedByDelete: mb(gl.deletedBytes), freedByGC: mb(gl.collectedBytes),
    },
    jsHeapMB: heap ? mb(heap.usedJSHeapSize) : null,
  };
  for (const [name, read] of extra) out[name] = read();
  return out;
}

const flag = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('memdebug') : null;
export const memoryDebug = flag !== null;
/** `?memdebug=norelease` keeps the previous run's data on a run change, to measure what releasing it saves. */
export const keepOldRuns = flag === 'norelease';

if (memoryDebug) {
  installGlTracker();
  (window as unknown as { ptypeMemory: typeof snapshot }).ptypeMemory = snapshot;
}
