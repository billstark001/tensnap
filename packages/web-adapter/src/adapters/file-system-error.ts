import type { FileSystemError as FileSystemErrorType } from '@tensnap/web-common/types/file';

/** Backend-independent filesystem failure with the adapter contract's error code. */
export class FileSystemError extends Error {
  public code: FileSystemErrorType['code'];
  public path?: string;
  public operation?: string;

  constructor(
    message: string,
    code: FileSystemErrorType['code'],
    path?: string,
    operation?: string,
  ) {
    super(message);
    this.name = 'FileSystemError';
    this.code = code;
    this.path = path;
    this.operation = operation;
  }
}
