import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { BenchmarkCase, BenchmarkRenderTriggerSelection, BenchmarkRuntimeMode, BenchmarkStats } from './types';
import { getCaseGroups } from './cases/variations';
import { resultsToJson, resultsToMarkdown, runBenchmark } from './runner';

const STORAGE_KEY = 'tensnap-web-benchmark-v3';
const runtimeMode: BenchmarkRuntimeMode = import.meta.env.PROD ? 'production' : 'development';

interface Config {
  frameCount: number;
  warmupCount: number;
  renderTrigger: BenchmarkRenderTriggerSelection;
  maxTps: number;
  maxRenderFps: number;
  components: boolean;
  models: boolean;
  randomWalk: boolean;
  allModelVariations: boolean;
}

const defaults: Config = {
  frameCount: 100,
  warmupCount: 10,
  renderTrigger: 'auto',
  maxTps: 300,
  maxRenderFps: 120,
  components: true,
  models: true,
  randomWalk: true,
  allModelVariations: false,
};

function loadConfig(): Config {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') } as Config; }
  catch { return defaults; }
}

function selectedCases(config: Config): BenchmarkCase[] {
  const enabled = { component: config.components, model: config.models, 'random-walk': config.randomWalk };
  return getCaseGroups(config.allModelVariations).flatMap((group) => enabled[group.category] ? group.cases : []);
}

function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

export function App() {
  const previewRef = useRef<HTMLDivElement>(null);
  const [config, setConfigState] = useState(loadConfig);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<BenchmarkStats[]>([]);

  const setConfig = (patch: Partial<Config>) => setConfigState((current) => {
    const next = { ...current, ...patch };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  });

  const run = async () => {
    const preview = previewRef.current;
    if (!preview || running) return;
    const cases = selectedCases(config);
    if (cases.length === 0) { setProgress('Select at least one benchmark category.'); return; }
    const modes = config.renderTrigger === 'all'
      ? (['auto', 'requestAnimationFrame', 'setTimeout'] as const)
      : [config.renderTrigger];
    const totalRuns = cases.length * modes.length;
    const nextResults: BenchmarkStats[] = [];
    setRunning(true); setResults([]);
    try {
      let runIndex = 0;
      for (const renderTriggerMode of modes) {
        for (const benchCase of cases) {
          runIndex += 1;
          const identity = benchCase.variant ? `${benchCase.name} — ${benchCase.variant}` : benchCase.name;
          const label = `[${runIndex}/${totalRuns}] [${benchCase.category}] ${identity}`;
          setProgress(`${label} · mounting…`);
          const result = await runBenchmark(benchCase, preview, config.frameCount, config.warmupCount, {
            renderTriggerMode, maxTps: config.maxTps, maxRenderFps: config.maxRenderFps, runtimeMode,
            onProgress: (done, total) => setProgress(`${label} · ${done}/${total} measured cycles`),
          });
          if (result.category === 'random-walk') {
            const raw = result.variant === 'raw-leafer'
              ? result
              : nextResults.find((candidate) => candidate.category === 'random-walk'
                && candidate.variant === 'raw-leafer'
                && candidate.renderTriggerMode === result.renderTriggerMode);
            if (raw && raw.meanMs > 0) {
              result.overheadVsRawPercent = Math.round(((result.meanMs / raw.meanMs) - 1) * 1_000) / 10;
            }
            if (raw?.mutation && result.mutation && raw.mutation.meanMs > 0) {
              result.mutationOverheadVsRawPercent = Math.round(((result.mutation.meanMs / raw.mutation.meanMs) - 1) * 1_000) / 10;
            }
          }
          nextResults.push(result);
          setResults([...nextResults]);
        }
      }
      setProgress('Done. Models that stopped early are included with their actual stop reason.');
    } catch (error) {
      setProgress(`Failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      preview.replaceChildren(); setRunning(false);
    }
  };

  return <div style={styles.root}>
    <header style={styles.header}>
      <h1 style={styles.title}>TenSnap Web Benchmark</h1>
      <p style={styles.muted}>Three suites: isolated production Web components, complete transported models, and a controlled random-walk overhead comparison. Build: <strong>{runtimeMode}</strong>.</p>
    </header>
    <main style={styles.main}>
      <section style={styles.panel}>
        <h2 style={styles.heading}>Configuration</h2>
        <Field label="Render trigger"><select value={config.renderTrigger} disabled={running} onChange={(event) => setConfig({ renderTrigger: event.target.value as BenchmarkRenderTriggerSelection })} style={styles.input}>
          <option value="all">All production modes</option><option value="auto">auto</option><option value="requestAnimationFrame">requestAnimationFrame</option><option value="setTimeout">setTimeout</option>
        </select></Field>
        <NumberField label="Measured cycles" value={config.frameCount} min={1} max={1000} disabled={running} onChange={(frameCount) => setConfig({ frameCount })} />
        <NumberField label="Warmup cycles" value={config.warmupCount} min={0} max={200} disabled={running} onChange={(warmupCount) => setConfig({ warmupCount })} />
        <NumberField label="Web max TPS (0 = unlimited)" value={config.maxTps} min={0} max={1000} disabled={running} onChange={(maxTps) => setConfig({ maxTps })} />
        <NumberField label="Web max render FPS (0 = unlimited)" value={config.maxRenderFps} min={0} max={240} disabled={running} onChange={(maxRenderFps) => setConfig({ maxRenderFps })} />
        <h3 style={styles.subheading}>Suites</h3>
        <Check label="Components (6 no-transport cases)" checked={config.components} disabled={running} onChange={(components) => setConfig({ components })} />
        <Check label="Complete models (Axelrod, Schelling, Wolf-Sheep)" checked={config.models} disabled={running} onChange={(models) => setConfig({ models })} />
        <Check label="Random walk (raw / layers / transport)" checked={config.randomWalk} disabled={running} onChange={(randomWalk) => setConfig({ randomWalk })} />
        <Check label="Run all complete-model size variations" checked={config.allModelVariations} disabled={running} onChange={(allModelVariations) => setConfig({ allModelVariations })} />
        <div style={styles.actions}><button type="button" onClick={() => void run()} disabled={running} style={styles.primaryButton}>{running ? 'Running…' : 'Run benchmarks'}</button><button type="button" onClick={() => setConfig(defaults)} disabled={running} style={styles.secondaryButton}>Reset</button></div>
        {progress && <p style={styles.progress}>{progress}</p>}
      </section>
      <Results results={results} />
    </main>
    <section style={styles.previewSection}><h2 style={styles.heading}>Live benchmark preview</h2><div ref={previewRef} style={styles.preview} /></section>
  </div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label style={styles.field}><span>{label}</span>{children}</label>; }
function NumberField(props: { label: string; value: number; min: number; max: number; disabled: boolean; onChange(value: number): void }) { return <Field label={props.label}><input type="number" value={props.value} min={props.min} max={props.max} disabled={props.disabled} onChange={(event) => props.onChange(Number(event.target.value))} style={styles.input} /></Field>; }
function Check(props: { label: string; checked: boolean; disabled: boolean; onChange(value: boolean): void }) { return <label style={styles.check}><input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(event) => props.onChange(event.target.checked)} />{props.label}</label>; }

function Results({ results }: { results: BenchmarkStats[] }) {
  const json = useMemo(() => resultsToJson(results), [results]);
  const markdown = useMemo(() => resultsToMarkdown(results), [results]);
  return <section style={{ ...styles.panel, ...styles.results }}><h2 style={styles.heading}>Results</h2>{results.length === 0 ? <p style={styles.muted}>No results yet.</p> : <>
    <div style={styles.tableWrap}><table style={styles.table}><thead><tr>{['Suite', 'Variant', 'Trigger', 'Case', 'Completed', 'Stop', 'Cycle mean', 'Cycle p95', 'TPS', 'Mutation mean', 'Mutation p95', 'vs raw'].map((label) => <th key={label} style={styles.cell}>{label}</th>)}</tr></thead>
      <tbody>{results.map((result, index) => <tr key={`${result.category}-${result.caseName}-${result.variant}-${result.renderTriggerMode}-${index}`}>
        <td style={styles.cell}>{result.category}</td><td style={styles.cell}>{result.variant ?? '—'}</td><td style={styles.cell}>{result.renderTriggerMode}</td><td style={styles.cell}>{result.caseName}</td>
        <td style={styles.number}>{result.completedFrames}/{result.requestedFrames}</td><td style={styles.cell}>{result.stopReason}</td><td style={styles.number}>{result.meanMs}</td><td style={styles.number}>{result.p95Ms}</td><td style={styles.number}>{result.tps}</td><td style={styles.number}>{result.mutation?.meanMs ?? '—'}</td><td style={styles.number}>{result.mutation?.p95Ms ?? '—'}</td><td style={styles.number}>{result.overheadVsRawPercent === undefined ? '—' : `${result.overheadVsRawPercent}%`}</td>
      </tr>)}</tbody></table></div>
    <div style={styles.actions}><button type="button" style={styles.secondaryButton} onClick={() => void navigator.clipboard.writeText(json)}>Copy JSON</button><button type="button" style={styles.secondaryButton} onClick={() => download('tensnap-web-benchmark.json', json, 'application/json')}>Download JSON</button><button type="button" style={styles.secondaryButton} onClick={() => void navigator.clipboard.writeText(markdown)}>Copy Markdown</button><button type="button" style={styles.secondaryButton} onClick={() => download('tensnap-web-benchmark.md', markdown, 'text/markdown')}>Download Markdown</button></div>
  </>}</section>;
}

const styles: Record<string, CSSProperties> = {
  root: { minHeight: '100vh', background: '#0f0f13', color: '#e5e7eb', fontFamily: 'system-ui, sans-serif' }, header: { padding: '24px 32px', borderBottom: '1px solid #2d2d38' }, title: { margin: 0, fontSize: 24 }, muted: { color: '#9ca3af', fontSize: 13, lineHeight: 1.5 }, main: { display: 'flex', gap: 24, padding: 24, alignItems: 'flex-start', flexWrap: 'wrap' }, panel: { background: '#1a1a22', border: '1px solid #2d2d38', borderRadius: 10, padding: 20, minWidth: 320 }, results: { flex: 1, overflow: 'hidden' }, heading: { margin: '0 0 14px', fontSize: 16, color: '#c7d2fe' }, subheading: { margin: '16px 0 8px', fontSize: 13, color: '#c7d2fe' }, field: { display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 11, fontSize: 13 }, input: { background: '#101018', color: '#e5e7eb', border: '1px solid #3f3f50', borderRadius: 6, padding: '7px 9px' }, check: { display: 'flex', gap: 8, alignItems: 'center', margin: '9px 0', fontSize: 13 }, actions: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }, primaryButton: { padding: '8px 14px', border: 0, borderRadius: 7, background: '#4f46e5', color: 'white', fontWeight: 600 }, secondaryButton: { padding: '7px 12px', border: '1px solid #3f3f50', borderRadius: 7, background: '#242430', color: '#e5e7eb' }, progress: { marginBottom: 0, color: '#6ee7b7', fontSize: 12, maxWidth: 420 }, tableWrap: { overflowX: 'auto' }, table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 }, cell: { padding: '8px 10px', borderBottom: '1px solid #30303b', textAlign: 'left', whiteSpace: 'nowrap' }, number: { padding: '8px 10px', borderBottom: '1px solid #30303b', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }, previewSection: { padding: 24, borderTop: '1px solid #2d2d38' }, preview: { minHeight: 80, overflow: 'auto', background: '#f5f5f5', borderRadius: 8 },
};
