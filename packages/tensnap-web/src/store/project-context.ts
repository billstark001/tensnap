import { createContext, useContext } from 'react';
import type { ProjectContextScheme } from './project';

/** The actual in-process owner, distinct from the currently selected tab. */
export const ProjectContext = createContext<ProjectContextScheme | null>(null);
export const useDialogProject = () => useContext(ProjectContext);
