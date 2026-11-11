/**
 * Typed access to autumnplot-gl, which is loaded as a browser bundle by a
 * script tag in index.html (see vite.config.ts for why).
 */
import type * as Apgl from 'autumnplot-gl';

const apgl = (globalThis as { apgl?: typeof Apgl }).apgl;
if (!apgl) throw new Error('autumnplot-gl did not load (public/autumnplot/autumnplot-gl.js)');

export const {
  Barbs, ColorMap, Contour, ContourFill, ContourLabels, LambertGrid, PlotLayer, Raster,
  RawScalarField, RawVectorField, colormaps, initAutumnPlot, makeColorBar,
} = apgl;

export type ColorMap = Apgl.ColorMap;
export type LambertGrid = Apgl.LambertGrid;
export type ContourLabels<A extends Apgl.TypedArray, G extends Apgl.StructuredGrid, M extends Apgl.MapLikeType> =
  Apgl.ContourLabels<A, G, M>;
export type PlotComponent<M extends Apgl.MapLikeType> = Apgl.PlotComponent<M>;
