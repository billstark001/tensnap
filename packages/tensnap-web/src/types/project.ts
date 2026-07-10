import { ScenarioSnapshot } from '@tensnap/core';
import type { Snapshot } from '@tensnap/core/snapshot';
import { ContainerView } from "./ui";

export interface ProjectSettings {
  maxSnapshots: number;
}

export interface ProjectFileContent {
  url: string;
  mainView: ContainerView;
  scenario: ScenarioSnapshot;
  snapshots: Snapshot[];
}

export const defaultProjectSettings = (): ProjectSettings => ({
  maxSnapshots: 32,
});
