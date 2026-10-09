import path from 'node:path';

/** Generated evidence can be versioned without becoming part of the measured source. */
export function sourcePathspecs(
  repositoryRoot: string,
  generatedDirectories: readonly (string | undefined)[] = [],
): string[] {
  const exclusions = new Set<string>();
  const directories = [
    path.join(repositoryRoot, 'benchmark-results'),
    path.join(repositoryRoot, 'evaluation-results'),
    ...generatedDirectories,
  ];
  for (const directory of directories) {
    if (!directory) continue;
    const relative = path.relative(repositoryRoot, path.resolve(repositoryRoot, directory));
    if (!relative)
      throw new Error('Generated evaluation directories must not be the repository root.');
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      continue;
    exclusions.add(`:(top,literal,exclude)${relative.split(path.sep).join('/')}`);
  }
  return ['--', '.', ...exclusions];
}
