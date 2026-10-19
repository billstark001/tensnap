import { Scenario } from '@tensnap/core';
import type { AgentDetailsDialogProps } from '../dialogs/AgentDetailsDialog';
import type { SimulatorInfoDialogProps } from '../dialogs/SimulatorInfoDialog';
import { createAgentInspectionSource } from './agent-inspection-source';
import {
  AuxiliaryCommandSchema,
  type AuxiliaryCommand,
  type AuxiliaryState,
  type AuxiliaryWindowId,
} from './auxiliary-protocol';
import { runWorkbenchCommand } from './commands';
import { useProjectStore } from '../store/project';
import { useSettingsStore } from '../store/settings';

/** Owner-only inputs. These objects and callbacks never cross the wire. */
type OwnerProps = {
  AgentDetailsDialog: AgentDetailsDialogProps;
  SimulatorInfoDialog: SimulatorInfoDialogProps;
};
export function createAuxiliaryWindowOwner<K extends AuxiliaryWindowId>(
  id: K,
  initialProps: OwnerProps[K],
  projectId: string | null,
) {
  const project =
    projectId === null
      ? null
      : useProjectStore.getState().projects.find((entry) => entry.id === projectId);
  if (projectId !== null && !project) throw new Error('The owner project has closed.');
  let props = initialProps;
  const scenario = initialProps.scenario;
  if (!(scenario instanceof Scenario))
    throw new Error('A native tool window requires an owner scenario.');
  const agent = id === 'AgentDetailsDialog' ? (initialProps as AgentDetailsDialogProps) : undefined;
  if (agent && !agent.agentRef)
    throw new Error('A native inspector requires a stable agent reference.');
  const inspection = agent ? createAgentInspectionSource(scenario, agent.agentRef!) : undefined;
  const session =
    project?.useScenarioStore.getState().scenario === scenario
      ? project.useScenarioStore.getState().session
      : undefined;
  let disposed = false;
  let revision = 0;
  const listeners = new Set<() => void>();
  const changed = () => {
    if (!disposed) {
      revision++;
      listeners.forEach((listener) => listener());
    }
  };
  const stopSettings = useSettingsStore.subscribe((next, before) => {
    if (next.theme !== before.theme || next.locale !== before.locale) changed();
  });
  const stopProjects = useProjectStore.subscribe(() => {
    if (!isAlive()) changed();
  });
  if (!inspection) {
    scenario.addEventListener('metadata:update', changed);
    session?.addEventListener('simulator:info', changed);
  }
  function isAlive() {
    return (
      !disposed &&
      (!project || useProjectStore.getState().projects.some((entry) => entry.id === project.id))
    );
  }
  function assertAlive() {
    if (!isAlive()) throw new Error('The owner project has closed.');
  }
  return {
    isAlive,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(next: OwnerProps[K]): boolean {
      if (disposed || next.scenario !== scenario) return false;
      const previous = props;
      props = next; // Local callbacks always advance independently of published data.
      if (inspection) {
        const target = (next as AgentDetailsDialogProps).agentRef;
        if (!target) return false;
        if (
          inspection.retarget(target) ||
          (next as AgentDetailsDialogProps).agentType !==
            (previous as AgentDetailsDialogProps).agentType
        ) {
          changed();
          return true;
        }
      } else if (
        (next as SimulatorInfoDialogProps).simulatorInfo !==
        (previous as SimulatorInfoDialogProps).simulatorInfo
      ) {
        changed();
        return true;
      }
      return false;
    },
    state(): AuxiliaryState {
      assertAlive();
      const { theme, locale } = useSettingsStore.getState();
      const content: AuxiliaryState['content'] = inspection
        ? {
            id: 'AgentDetailsDialog',
            target: { ...(props as AgentDetailsDialogProps).agentRef! },
            agentType: (props as AgentDetailsDialogProps).agentType ?? '2d',
          }
        : {
            id: 'SimulatorInfoDialog',
            simulatorInfo:
              session?.simulatorInfo ?? (props as SimulatorInfoDialogProps).simulatorInfo,
            metadata: structuredClone(scenario.metadata),
          };
      return {
        version: 1,
        revision,
        projectId: project?.id ?? null,
        appearance: { theme, locale },
        content,
      };
    },
    async execute(input: AuxiliaryCommand, signal: AbortSignal): Promise<unknown> {
      assertAlive();
      signal.throwIfAborted();
      const command = AuxiliaryCommandSchema.parse(input);
      switch (command.method) {
        case 'initialize':
          return this.state();
        case 'inspect':
          if (!inspection) throw new Error('This window cannot inspect agents.');
          return inspection.read(command.request, signal);
        case 'menu':
          await runWorkbenchCommand(command.command, project?.id ?? null);
          return null;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopSettings();
      stopProjects();
      listeners.clear();
      inspection?.dispose();
      scenario.removeEventListener('metadata:update', changed);
      session?.removeEventListener('simulator:info', changed);
    },
  };
}
