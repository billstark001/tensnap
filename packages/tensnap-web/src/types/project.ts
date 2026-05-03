import { ScenarioSnapshot } from '@tensnap/core';
import { ContainerView } from "./ui";

export interface ProjectSettings {
  maxSnapshots: number;
}

export interface ProjectFileContent {
  url: string;
  mainView: ContainerView;
  scenario: ScenarioSnapshot;
}

export const defaultProjectSettings = (): ProjectSettings => ({
  maxSnapshots: 32,
});