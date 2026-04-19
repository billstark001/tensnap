import { signal, computed, effect } from '@preact/signals';
import { useRef } from 'preact/hooks';
import { BenchmarkStats, BenchmarkCase } from './types';
import { runBenchmark, resultsToJson, resultsToMarkdown } from './runner';
import {
  lineChartVariations,
  particleBounceVariations,
  springGraphVariations,
  getAllVariations,
} from './cases/variations';
import { schellingVariations } from './cases/schellingModel';
import { wolfSheepVariations } from './cases/wolfSheepModel';

// ─── Persistence ─────────────────────────────────────────────────────────────
const LS_KEY = 'tensnap-benchmark-config';

interface PersistedConfig {
  frameCount: number;
  warmupCount: number;
  enableLineChart: boolean;
  enableParticle: boolean;
  enableSpring: boolean;
  enableSchelling: boolean;
  enableWolfSheep: boolean;
  enableVariations: boolean;
}

const DEFAULTS: PersistedConfig = {
  frameCount: 300,
  warmupCount: 10,
  enableLineChart: true,
  enableParticle: true,
  enableSpring: true,
  enableSchelling: true,
  enableWolfSheep: true,
  enableVariations: false,
};

function loadConfig(): PersistedConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { }
  return { ...DEFAULTS };
}

function saveConfig(cfg: PersistedConfig) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cfg));
  } catch { }
}

// ─── State ────────────────────────────────────────────────────────────────────
const _initial = loadConfig();

const running = signal(false);
const progressText = signal('');
const results = signal<BenchmarkStats[]>([]);
const copyStatus = signal<'idle' | 'json' | 'md'>('idle');

const frameCount = signal(_initial.frameCount);
const warmupCount = signal(_initial.warmupCount);

// Enable/disable existing cases
const enableLineChart = signal(_initial.enableLineChart);
const enableParticle = signal(_initial.enableParticle);
const enableSpring = signal(_initial.enableSpring);

// Enable/disable model cases
const enableSchelling = signal(_initial.enableSchelling);
const enableWolfSheep = signal(_initial.enableWolfSheep);

// Enable variations mode
const enableVariations = signal(_initial.enableVariations);

const hasResults = computed(() => results.value.length > 0);

// Persist config changes to localStorage
effect(() => {
  saveConfig({
    frameCount: frameCount.value,
    warmupCount: warmupCount.value,
    enableLineChart: enableLineChart.value,
    enableParticle: enableParticle.value,
    enableSpring: enableSpring.value,
    enableSchelling: enableSchelling.value,
    enableWolfSheep: enableWolfSheep.value,
    enableVariations: enableVariations.value,
  });
});

function resetConfig() {
  frameCount.value = DEFAULTS.frameCount;
  warmupCount.value = DEFAULTS.warmupCount;
  enableLineChart.value = DEFAULTS.enableLineChart;
  enableParticle.value = DEFAULTS.enableParticle;
  enableSpring.value = DEFAULTS.enableSpring;
  enableSchelling.value = DEFAULTS.enableSchelling;
  enableWolfSheep.value = DEFAULTS.enableWolfSheep;
  enableVariations.value = DEFAULTS.enableVariations;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function download(filename: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function handleRun(containerRef: HTMLElement) {
  if (running.value) return;
  running.value = true;
  results.value = [];

  let cases: BenchmarkCase[] = [];

  if (enableVariations.value) {
    // Run all variations of selected cases
    const allVars = getAllVariations();
    for (const variation of allVars) {
      if (variation.name === 'LineChart' && enableLineChart.value) {
        cases.push(...variation.cases);
      } else if (variation.name === 'ParticleBounce' && enableParticle.value) {
        cases.push(...variation.cases);
      } else if (variation.name === 'SpringGraph' && enableSpring.value) {
        cases.push(...variation.cases);
      }
    }

    // Add model variations
    if (enableSchelling.value) {
      cases.push(...schellingVariations);
    }
    if (enableWolfSheep.value) {
      cases.push(...wolfSheepVariations);
    }
  } else {
    // Run single default configuration of each selected case
    if (enableLineChart.value) {
      cases.push(lineChartVariations.cases[1]); // medium config
    }
    if (enableParticle.value) {
      cases.push(particleBounceVariations.cases[1]); // medium config
    }
    if (enableSpring.value) {
      cases.push(springGraphVariations.cases[1]); // medium config
    }
    if (enableSchelling.value) {
      cases.push(schellingVariations[1]); // medium config
    }
    if (enableWolfSheep.value) {
      cases.push(wolfSheepVariations[1]); // medium config
    }
  }

  if (cases.length === 0) {
    running.value = false;
    progressText.value = 'Please select at least one benchmark.';
    return;
  }

  const allResults: BenchmarkStats[] = [];
  for (let ci = 0; ci < cases.length; ci++) {
    const bc = cases[ci];
    progressText.value = `Running [${ci + 1}/${cases.length}] ${bc.name}…`;

    const res = await runBenchmark(
      bc,
      containerRef,
      frameCount.value,
      warmupCount.value,
      (done, total) => {
        progressText.value = `[${ci + 1}/${cases.length}] ${bc.name} — ${done}/${total} frames`;
      }
    );
    allResults.push(res);
  }

  results.value = allResults;
  progressText.value = 'Done!';
  running.value = false;
}

async function copyText(text: string, which: 'json' | 'md') {
  await navigator.clipboard.writeText(text);
  copyStatus.value = which;
  setTimeout(() => { copyStatus.value = 'idle'; }, 1500);
}

// ─── Components ───────────────────────────────────────────────────────────────
function ConfigPanel({ containerRef }: { containerRef: { current: HTMLElement | null } }) {
  return (
    <div style={styles.panel}>
      <h2 style={styles.panelTitle}>Configuration</h2>

      <label style={styles.label}>
        Frames per benchmark
        <input
          type="number"
          min={10}
          max={1000}
          value={frameCount.value}
          disabled={running.value}
          onInput={(e) => { frameCount.value = Number((e.target as HTMLInputElement).value); }}
          style={styles.input}
        />
      </label>

      <label style={styles.label}>
        Warmup frames
        <input
          type="number"
          min={0}
          max={100}
          value={warmupCount.value}
          disabled={running.value}
          onInput={(e) => { warmupCount.value = Number((e.target as HTMLInputElement).value); }}
          style={styles.input}
        />
      </label>

      <div style={{ marginTop: 16 }}>
        <p style={styles.sectionLabel}>Cases to run</p>
        {[
          { sig: enableLineChart, label: 'LineChartView (multi-line)' },
          { sig: enableParticle, label: 'EnvironmentView (particle bounce)' },
          { sig: enableSpring, label: 'EnvironmentView (E-R spring graph)' },
          { sig: enableSchelling, label: 'Schelling Segregation Model' },
          { sig: enableWolfSheep, label: 'Wolf-Sheep Predation Model' },
        ].map(({ sig, label }) => (
          <label key={label} style={styles.checkLabel}>
            <input
              type="checkbox"
              checked={sig.value}
              disabled={running.value}
              onChange={() => { sig.value = !sig.value; }}
              style={{ marginRight: 8, accentColor: '#6ee7b7' }}
            />
            {label}
          </label>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={styles.checkLabel}>
          <input
            type="checkbox"
            checked={enableVariations.value}
            disabled={running.value}
            onChange={() => { enableVariations.value = !enableVariations.value; }}
            style={{ marginRight: 8, accentColor: '#fbbf24' }}
          />
          <strong>Run all parameter variations</strong>
        </label>
        <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 4, marginLeft: 24 }}>
          When enabled, runs 3-4 configurations of each selected case
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          onClick={() => containerRef.current && handleRun(containerRef.current)}
          disabled={running.value}
          style={{ ...styles.button, marginTop: 0, flex: 1, ...(running.value ? styles.buttonDisabled : {}) }}
        >
          {running.value ? 'Running…' : 'Run Benchmarks'}
        </button>
        <button
          onClick={resetConfig}
          disabled={running.value}
          style={{ ...styles.button, marginTop: 0, background: '#374151', ...(running.value ? styles.buttonDisabled : { background: '#374151' }) }}
          title="Reset all settings to defaults"
        >
          Reset
        </button>
      </div>

      {progressText.value && (
        <p style={styles.progressText}>{progressText.value}</p>
      )}
    </div>
  );
}

function ResultsTable() {
  if (!hasResults.value) {
    return (
      <div style={styles.emptyState}>
        <p style={{ color: '#888', fontSize: 14 }}>
          No results yet. Configure and click <strong>Run Benchmarks</strong>.
        </p>
      </div>
    );
  }

  const rows = results.value;
  const jsonStr = resultsToJson(rows);
  const mdStr = resultsToMarkdown(rows);

  return (
    <div>
      <div style={styles.tableWrapper}>
        <table style={styles.table}>
          <thead>
            <tr>
              {['Case', 'Frames', 'Mean ms', 'Median ms', 'Min ms', 'Max ms', 'p95 ms', 'TPS'].map(
                (h) => <th key={h} style={styles.th}>{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={i % 2 === 0 ? styles.rowEven : styles.rowOdd}>
                <td style={{ ...styles.td, fontWeight: 600 }}>{r.caseName}</td>
                <td style={styles.tdNum}>{r.frames}</td>
                <td style={styles.tdNum}>{r.meanMs}</td>
                <td style={styles.tdNum}>{r.medianMs}</td>
                <td style={styles.tdNum}>{r.minMs}</td>
                <td style={styles.tdNum}>{r.maxMs}</td>
                <td style={styles.tdNum}>{r.p95Ms}</td>
                <td style={{ ...styles.tdNum, color: tpsColor(r.tps) }}>{r.tps}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={styles.exportRow}>
        {/* Copy JSON */}
        <button
          style={styles.exportBtn}
          onClick={() => copyText(jsonStr, 'json')}
        >
          {copyStatus.value === 'json' ? '✓ Copied!' : 'Copy JSON'}
        </button>

        {/* Download JSON */}
        <button
          style={styles.exportBtn}
          onClick={() => download('benchmark-results.json', jsonStr, 'application/json')}
        >
          Download JSON
        </button>

        {/* Copy Markdown */}
        <button
          style={styles.exportBtn}
          onClick={() => copyText(mdStr, 'md')}
        >
          {copyStatus.value === 'md' ? '✓ Copied!' : 'Copy Markdown'}
        </button>

        {/* Download Markdown */}
        <button
          style={styles.exportBtn}
          onClick={() => download('benchmark-results.md', mdStr, 'text/markdown')}
        >
          Download Markdown
        </button>
      </div>

      {/* Raw JSON preview */}
      <details style={styles.details}>
        <summary style={{ cursor: 'pointer', color: '#9ca3af', fontSize: 13 }}>
          Raw JSON
        </summary>
        <pre style={styles.pre}>{jsonStr}</pre>
      </details>

      {/* Markdown preview */}
      <details style={styles.details}>
        <summary style={{ cursor: 'pointer', color: '#9ca3af', fontSize: 13 }}>
          Markdown
        </summary>
        <pre style={styles.pre}>{mdStr}</pre>
      </details>
    </div>
  );
}

function tpsColor(tps: number): string {
  if (tps >= 50) return '#6ee7b7';
  if (tps >= 30) return '#fcd34d';
  return '#f87171';
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export function App() {
  const containerRef = useRef<HTMLElement | null>(null);

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <h1 style={styles.title}>TenSnap Web Core — Benchmark Suite</h1>
        <p style={styles.subtitle}>
          Measures per-tick compute latency (MSPT) and effective TPS while yielding one
          <code>requestAnimationFrame</code> turn after each tick.
        </p>
      </header>

      <main style={styles.main}>
        <ConfigPanel containerRef={containerRef} />
        <section style={styles.results}>
          <h2 style={styles.panelTitle}>Results</h2>
          <ResultsTable />
        </section>
      </main>

      {/* Visible container for benchmark canvases */}
      <section style={styles.canvasSection}>
        <h2 style={styles.panelTitle}>Live Preview</h2>
        <div
          ref={(el) => { containerRef.current = el; }}
          style={styles.canvasContainer}
        />
      </section>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles: Record<string, import('preact').JSX.CSSProperties> = {
  root: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#0f0f13',
    color: '#e0e0e0',
  },
  header: {
    padding: '24px 32px 16px',
    borderBottom: '1px solid #2a2a35',
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: '#f3f4f6',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: '#9ca3af',
  },
  main: {
    display: 'flex',
    flexDirection: 'row',
    gap: 24,
    padding: '24px 32px',
    flex: 1,
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  panel: {
    background: '#1a1a22',
    border: '1px solid #2a2a35',
    borderRadius: 10,
    padding: '20px 24px',
    minWidth: 280,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  results: {
    flex: 1,
    background: '#1a1a22',
    border: '1px solid #2a2a35',
    borderRadius: 10,
    padding: '20px 24px',
    minWidth: 300,
  },
  panelTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#c7d2fe',
    marginBottom: 4,
  },
  sectionLabel: {
    fontSize: 13,
    color: '#9ca3af',
    marginBottom: 8,
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: 13,
    color: '#d1d5db',
  },
  input: {
    background: '#0f0f18',
    border: '1px solid #3a3a50',
    borderRadius: 6,
    color: '#e0e0e0',
    padding: '5px 10px',
    fontSize: 13,
    outline: 'none',
    width: '100%',
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    fontSize: 13,
    color: '#d1d5db',
    marginBottom: 6,
    cursor: 'pointer',
  },
  button: {
    marginTop: 8,
    padding: '9px 18px',
    background: '#4f46e5',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 14,
    transition: 'background 0.2s',
  },
  buttonDisabled: {
    background: '#374151',
    cursor: 'not-allowed',
    color: '#9ca3af',
  },
  progressText: {
    fontSize: 12,
    color: '#6ee7b7',
    wordBreak: 'break-all',
    marginTop: 4,
  },
  tableWrapper: {
    overflowX: 'auto',
    marginBottom: 16,
  },
  table: {
    borderCollapse: 'collapse',
    width: '100%',
    fontSize: 13,
  },
  th: {
    background: '#232330',
    color: '#9ca3af',
    padding: '8px 14px',
    textAlign: 'left',
    borderBottom: '1px solid #2a2a35',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '7px 14px',
    borderBottom: '1px solid #1e1e28',
    color: '#e0e0e0',
  },
  tdNum: {
    padding: '7px 14px',
    borderBottom: '1px solid #1e1e28',
    textAlign: 'right',
    color: '#e0e0e0',
    fontVariantNumeric: 'tabular-nums',
  },
  rowEven: {},
  rowOdd: { background: '#181820' },
  exportRow: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  exportBtn: {
    padding: '6px 14px',
    background: '#232330',
    border: '1px solid #3a3a50',
    borderRadius: 7,
    color: '#d1d5db',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
  },
  canvasSection: {
    background: '#1a1a22',
    borderTop: '1px solid #2a2a35',
    padding: '20px 32px',
  },
  canvasContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 12,
    minHeight: 40,
  },
  emptyState: {
    padding: '40px 0',
    textAlign: 'center',
  },
  details: {
    marginBottom: 12,
  },
  pre: {
    background: '#0f0f18',
    border: '1px solid #2a2a35',
    borderRadius: 8,
    padding: 14,
    fontSize: 11,
    color: '#9ca3af',
    overflowX: 'auto',
    maxHeight: 300,
    overflow: 'auto',
    marginTop: 8,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
};
