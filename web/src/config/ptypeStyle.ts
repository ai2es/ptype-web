/** Colours for the four precipitation types, shared by the map, legend and bar chart. */
import type { PtypeClass } from '../data/ptype';

export interface PtypeStyle {
  id: PtypeClass;
  label: string;
  /** Solid colour used for bars and text. */
  color: string;
  /** Map ramp for probability bins 0-0.1, 0.1-0.2, ... 0.9-1.0 (matplotlib Greens/Blues/Purples/Reds). */
  ramp: string[];
}

/** Order matches the model's output classes. */
export const PTYPE_STYLES: PtypeStyle[] = [
  {
    id: 'rain',
    label: 'Rain',
    color: 'rgb(0,108,38)',
    ramp: ['#f0f9ed', '#dff3da', '#c7e9c0', '#a9dca3', '#86cc85', '#60ba6c', '#3ba458', '#228a44', '#077331', '#005321'],
  },
  {
    id: 'snow',
    label: 'Snow',
    color: 'rgb(0,79,146)',
    ramp: ['#eef5fc', '#d9e8f5', '#c6dbef', '#a6cee4', '#7fb9da', '#5ba3d0', '#3b8bc2', '#2070b4', '#0d57a1', '#083c7d'],
  },
  {
    id: 'icep',
    label: 'Sleet',
    color: 'rgb(79,59,133)',
    ramp: ['#f7f6fa', '#ebe9f3', '#dadaeb', '#c2c3df', '#aaa8d0', '#928fc3', '#7b74b5', '#6950a3', '#582f93', '#470f84'],
  },
  {
    id: 'frzr',
    label: 'Freezing rain',
    color: 'rgb(177,0,0)',
    ramp: ['#ffede5', '#fed9c9', '#fcbba1', '#fc9b7c', '#fb7a5a', '#f6583e', '#e83429', '#ca181d', '#ac1117', '#7e0610'],
  },
];

export const UNCERTAINTY_COLOR = '#1a1a1a';
/** Lowest probability bin shown in the legend (the winning class is always at least 0.25). */
export const LEGEND_MIN_PROB = 0.3;
