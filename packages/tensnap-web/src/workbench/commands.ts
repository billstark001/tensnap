export const WORKBENCH_COMMANDS = [
  'new',
  'open',
  'open-recording',
  'save',
  'save-as',
  'undo',
  'redo',
  'settings',
  'about',
  'documentation',
] as const;
export type WorkbenchCommand = (typeof WORKBENCH_COMMANDS)[number];
type CommandHandler = (projectId: string | null) => unknown;
const handlers = new Map<WorkbenchCommand, CommandHandler>();
export function registerWorkbenchCommands(
  commands: Record<WorkbenchCommand, CommandHandler>,
): () => void {
  for (const [name, handler] of Object.entries(commands))
    handlers.set(name as WorkbenchCommand, handler);
  return () => {
    for (const [name, handler] of Object.entries(commands))
      if (handlers.get(name as WorkbenchCommand) === handler)
        handlers.delete(name as WorkbenchCommand);
  };
}
export async function runWorkbenchCommand(
  command: WorkbenchCommand,
  projectId: string | null,
): Promise<unknown> {
  const handler = handlers.get(command);
  if (!handler) throw new Error(`Unsupported workbench command: ${command}`);
  return handler(projectId);
}
