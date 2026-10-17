import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
mkdirSync(new URL('../dist', import.meta.url), { recursive: true });
for (const [entry, platform] of [
  ['index', 'neutral'],
  ['node', 'node'],
]) {
  await build({
    absWorkingDir: root,
    bundle: true,
    entryPoints: [`src/${entry}.ts`],
    outdir: 'dist',
    format: 'esm',
    platform,
    target: 'node18',
    sourcemap: true,
  });
}
execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });
copyFileSync(
  new URL('../../../LICENSE', import.meta.url),
  new URL('../dist/LICENSE', import.meta.url),
);
