/** Always attempt removal; preserve the original failure when child teardown also fails. */
export async function finishResources(
  primaryError: unknown,
  stop: () => Promise<void>,
  remove: () => Promise<void>,
): Promise<void> {
  const failures: unknown[] = [];
  try {
    await stop();
  } catch (error) {
    failures.push(error);
  }
  try {
    await remove();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length)
    throw new AggregateError(
      [...(primaryError ? [primaryError] : []), ...failures],
      'Benchmark failed or cleanup did not complete.',
      { cause: primaryError },
    );
}
