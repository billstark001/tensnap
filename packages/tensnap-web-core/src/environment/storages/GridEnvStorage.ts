/**
 * environment/storages/GridEnvStorage.ts
 *
 * Stores grid environment dimensions and visual styling for the GridLayer.
 */

import { BaseStorage } from './BaseStorage';
import { GridCoordOffset } from '../types';

export interface GridEnvData {
  /** Number of grid columns. */
  width: number;
  /** Number of grid rows. */
  height: number;
  coordOffset?: GridCoordOffset;
  /** Base stroke color for grid lines (CSS color string).  Defaults to
   *  '#808080' — alpha is applied per detail level in the layer. */
  strokeColor?: string;
}

export class GridEnvStorage extends BaseStorage<GridEnvData> {
  constructor(initial: GridEnvData) {
    super(initial);
  }
}
