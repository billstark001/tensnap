import { runReplicateInCurrentProcess, type ReplicateRequest } from './runner';

async function readStdin(): Promise<string> {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function main(): Promise<void> {
  const input = await readStdin();
  const request = JSON.parse(input) as ReplicateRequest;
  const result = await runReplicateInCurrentProcess(request);
  process.stdout.write(JSON.stringify(result));
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
