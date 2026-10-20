// Completion can include thousands of action/store barriers. Keep the client's
// wait inside the command deadline, and leave time for validation and teardown
// before the isolated replicate deadline. These limits do not cancel a run.
export const completionTimeoutMs = 600_000;
export const commandTimeoutMs = completionTimeoutMs + 60_000;
export const replicateTimeoutMs = commandTimeoutMs + 240_000;

/** Apply the same completion budget to explicit waits and recording stop's implicit wait. */
export function completionArgs(args: string[], online: boolean): string[] {
  const waits = args.includes('--wait') || (args[0] === 'recording' && args[1] === 'stop');
  return online && waits && !args.includes('--timeout-ms')
    ? [...args, '--timeout-ms', String(completionTimeoutMs)]
    : args;
}

export function runWaitBody(until: 'settled' | 'persisted' = 'settled') {
  return { until, timeoutMs: completionTimeoutMs };
}
