import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { chromium } from 'playwright';
import { checkProfileLocks } from './config';
import { hashBytes } from './files';
import { execute } from './process';
import type { EvaluationSpecification, ExecutionContext } from './types';

/** Includes uncommitted source bytes for diagnostics; ignored run products never enter the fingerprint. */
export async function sourceIdentity(
  context: ExecutionContext,
): Promise<{ commit: string; dirty: boolean; filesSha256: string }> {
  const commit = await execute(context, 'git', ['rev-parse', 'HEAD'], { quiet: true });
  const status = await execute(context, 'git', ['status', '--porcelain'], { quiet: true });
  const names = (
    await execute(context, 'git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], {
      quiet: true,
    })
  )
    .split('\0')
    .filter(Boolean)
    .sort();
  const hashes = [];
  for (const name of names) {
    const hash = await readFile(path.join(context.repositoryRoot, name)).then(
      hashBytes,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return 'deleted';
        throw error;
      },
    );
    hashes.push([name, hash]);
  }
  return { commit, dirty: Boolean(status), filesSha256: hashBytes(JSON.stringify(hashes)) };
}

export async function inspectEnvironment(
  context: ExecutionContext,
  specification: EvaluationSpecification,
): Promise<Record<string, unknown>> {
  const locks = await checkProfileLocks(context.repositoryRoot, specification);
  const pythonCode = [
    'import importlib.metadata as m, json, platform, tensnap, mesa, solara, torch, pynetlogo, jpype, PIL',
    'names=["mesa","solara","ipyvue","ipyvuetify","torch","pynetlogo","jpype1","Pillow","websockets","msgpack","numpy"]',
    'print(json.dumps({"version":platform.python_version(),"packages":{n:m.version(n) for n in names},"bindingPath":tensnap.__file__}))',
  ].join('\n');
  const python = JSON.parse(
    (await execute(context, context.python, ['-c', pythonCode], { quiet: true }))
      .split('\n')
      .slice(-1)[0]!,
  );
  if (
    !path
      .resolve(python.bindingPath)
      .startsWith(path.join(context.repositoryRoot, 'packages/tensnap-python') + path.sep)
  )
    throw new Error('Python must import the binding from this checkout.');
  const installed = await execute(context, context.python, ['-m', 'pip', 'freeze'], {
    quiet: true,
  });
  const required = (
    await readFile(
      path.join(
        context.repositoryRoot,
        'benchmarks/environments/python-evaluation.requirements.lock',
      ),
      'utf8',
    )
  )
    .split('\n')
    .filter((line) => line && !line.startsWith('#'));
  const installedLines = new Set(installed.toLowerCase().split('\n'));
  for (const requirement of required)
    if (!installedLines.has(requirement.toLowerCase()))
      throw new Error(`Python environment does not match its lock: ${requirement}`);
  const go = await execute(context, 'go', ['version'], { quiet: true });
  await execute(
    context,
    'go',
    [
      'list',
      '-mod=readonly',
      '-modfile=../../../../evaluation/environments/go/go.mod',
      '-deps',
      './...',
    ],
    { cwd: path.join(context.repositoryRoot, 'benchmarks/schelling/v1/subjects/go'), quiet: true },
  );
  const juliaCode =
    'using TenSnap, Agents, WGLMakie, JSON3, Serialization; println(VERSION); println(pathof(TenSnap)); println(pkgversion(Agents)); println(pkgversion(WGLMakie))';
  const julia = (
    await execute(
      context,
      'julia',
      [`--project=${context.env.TENSNAP_JULIA_PROJECT}`, '-e', juliaCode],
      { quiet: true },
    )
  ).split('\n');
  if (
    !path
      .resolve(julia[1]!)
      .startsWith(path.join(context.repositoryRoot, 'packages/tensnap-julia') + path.sep)
  )
    throw new Error('Julia must import the binding from this checkout.');
  const browser = await chromium.launch({ headless: true });
  let browserVersion: string;
  try {
    browserVersion = browser.version();
  } finally {
    await browser.close();
  }
  // The adapter independently checks NetLogo 7.0.4 and its raster during every replicate.
  await readFile(path.join(context.env.NETLOGO_HOME!, 'NetLogo 7.0.4.app/Contents/Info.plist'));
  return {
    host: {
      os: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      memoryBytes: totalmem(),
    },
    node: process.version,
    pnpm: await execute(context, 'pnpm', ['--version'], { quiet: true }),
    python,
    pythonFreezeSha256: hashBytes(installed),
    go,
    julia: { version: julia[0], bindingPath: julia[1], agents: julia[2], wglmakie: julia[3] },
    chromium: { version: browserVersion, executable: chromium.executablePath() },
    netlogoHome: context.env.NETLOGO_HOME,
    locks,
  };
}
