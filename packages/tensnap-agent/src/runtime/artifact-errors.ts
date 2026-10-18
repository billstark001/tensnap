/** Invalid artifact contents fail before any simulator work or output commit. */
export class ArtifactInputError extends Error {
  readonly category = 'input_error';
  readonly exitCode = 2;
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
    this.name = 'ArtifactInputError';
  }
}

const FILE_FAILURE_CODES = new Set([
  'EACCES',
  'EPERM',
  'ENOENT',
  'EEXIST',
  'ENOSPC',
  'EISDIR',
  'ENOTDIR',
  'EROFS',
  'EDQUOT',
  'EIO',
  'EXDEV',
  'ENOTEMPTY',
]);
export function isFileSystemFailure(error: unknown): boolean {
  return FILE_FAILURE_CODES.has((error as NodeJS.ErrnoException | null)?.code ?? '');
}
