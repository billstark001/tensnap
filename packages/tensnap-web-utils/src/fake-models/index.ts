/**
 * Fake Models for TenSnap
 * 
 * Collection of built-in simulation models that run entirely in the browser
 * using the fake WebSocket protocol.
 */


// Schelling Segregation Model
export { SchellingModel, createSchellingSimulation, type SchellingConfig } from './schelling';

// Wolf-Sheep Predation Model
export { createWolfSheepSimulation, type WolfSheepConfig } from './wolf-sheep';
