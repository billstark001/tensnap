/**
 * environment/storages/index.ts
 */
export { BaseStorage } from './BaseStorage';
export { BackgroundStorage } from './BackgroundStorage';
export type { BackgroundData, BackgroundValue } from './BackgroundStorage';
export { loadImageAsync } from './BackgroundStorage';
export { GridEnvStorage } from './GridEnvStorage';
export type { GridEnvData } from './GridEnvStorage';
export { AgentStorage } from './AgentStorage';
export type { RenderableAgent, AgentStorageData } from './AgentStorage';
export { EdgeStorage } from './EdgeStorage';
export type { EdgeStorageData } from './EdgeStorage';
