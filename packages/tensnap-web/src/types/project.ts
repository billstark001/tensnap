import { SimulationState } from "./modeling";
import { ContainerView } from "./ui";

export interface ProjectSettings {
  maxSnapshots: number;
}

export interface ProjectFileContent {
  url: string;
  mainView: ContainerView;
  scenario: SimulationState;
}

export const defaultProjectSettings = (): ProjectSettings => ({
  maxSnapshots: 32,
});