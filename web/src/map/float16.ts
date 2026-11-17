/**
 * Data that is drawn from a texture (filled and raster layers, wind barbs) is
 * handed to autumnplot-gl as 16-bit floats.
 *
 * iPhones and iPads cannot use 32-bit float textures, and autumnplot-gl
 * refuses them there ("Float32 data are not supported on this hardware. Try
 * Float16 data instead."), which left every filled layer blank on those
 * devices. Half floats work everywhere and take half the graphics memory. They
 * carry about three significant digits, which is ample for values that end up
 * as a colour or a wind barb. Contours are traced on the CPU and keep 32 bits.
 */
import { Float16Array } from '@petamoriken/float16';

export function toFloat16(values: Float32Array): Float16Array {
  return new Float16Array(values);
}
