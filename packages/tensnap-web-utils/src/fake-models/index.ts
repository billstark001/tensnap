/**
 * Fake Models for TenSnap
 * 
 * Collection of built-in simulation models that run entirely in the browser
 * using the fake WebSocket protocol.
 */

import { createSchellingSimulation } from './schelling';

export { SchellingModel, createSchellingSimulation, type SchellingConfig } from './schelling';
export { FakeModelPickerProvider, useFakeModelPicker, type FakeModelPickerResult } from './FakeModelPickerProvider';

export interface FakeModelMetadata {
  id: string;
  name: string;
  description: string;
  url: string; // fake:model_id
  createOptions: () => any;
}

export const FAKE_MODELS: FakeModelMetadata[] = [
  {
    id: 'schelling',
    name: 'Schelling Segregation Model',
    description: 'Demonstrates how individual preferences for similar neighbors lead to large-scale segregation patterns.',
    url: 'fake:schelling',
    createOptions: () => createSchellingSimulation(),
  },
];

/**
 * Get a fake model by ID
 */
export function getFakeModel(id: string): FakeModelMetadata | undefined {
  return FAKE_MODELS.find(m => m.id === id);
}

/**
 * Register all fake models with the WebSocketManagerFake
 * This needs to be called from the web package after imports are available.
 */
export function registerFakeModels(WebSocketManagerFake: any) {
  for (const model of FAKE_MODELS) {
    WebSocketManagerFake.setGlobalOptions(model.url, model.createOptions());
  }
}
