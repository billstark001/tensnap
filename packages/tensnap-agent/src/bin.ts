import { classifyCliError, main } from './cli';

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = classifyCliError(error).exitCode;
});
