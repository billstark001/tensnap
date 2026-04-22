/**
 * Pure simulation models for TenSnap.
 *
 * This module only exports model logic and intentionally excludes
 * any transport/protocol adapter implementation.
 */

export { SchellingModel, type SchellingConfig } from './schelling';
export { WolfSheepModel, type WolfSheepConfig, type World } from './wolf-sheep';
export { initializeAxelrod, runAxelrod, stepAxelrod, type AxelrodConfig, type AxelrodState } from './axelrod';
export { initializeTornberg, runTornberg, stepTornberg, type TornbergConfig, type TornbergState } from './tornberg';
