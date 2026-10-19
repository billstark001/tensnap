import type { FileSystemAdapter } from '@tensnap/web-common/types/file';
import { FileSystemError } from './file-system-error';
import { getParentPath, normalizePath, validatePath } from '../utils/path';

export async function validateMove(
  fileSystem: FileSystemAdapter,
  sourcePath: string,
  targetPath: string,
) {
  const source = normalizePath(sourcePath);
  const target = normalizePath(targetPath);
  if (!validatePath(sourcePath) || !validatePath(targetPath) || source === '/' || target === '/')
    throw new FileSystemError('Invalid move path', 'INVALID_OPERATION', target);
  const directory = await fileSystem.directoryExists(source);
  if (!directory && !(await fileSystem.fileExists(source)))
    throw new FileSystemError('Source does not exist', 'NOT_FOUND', source);
  if (source === target) return { source, target };
  if (directory && target.startsWith(`${source}/`))
    throw new FileSystemError('Cannot move a directory into itself', 'INVALID_OPERATION', target);
  if ((await fileSystem.fileExists(target)) || (await fileSystem.directoryExists(target)))
    throw new FileSystemError('Destination already exists', 'PATH_EXISTS', target);
  if (!(await fileSystem.directoryExists(getParentPath(target))))
    throw new FileSystemError('Destination directory does not exist', 'NOT_FOUND', target);
  return { source, target };
}
