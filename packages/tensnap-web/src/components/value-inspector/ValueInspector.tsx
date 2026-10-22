import { ScrollArea } from '@tensnap/web-common/components/ui/ScrollArea';
import type { ProtocolData } from '@tensnap/protocol';
import {
  ValueInspector as Inspector,
  valueInspectorText,
  type ValueInspectorContent,
  type ValueInspectorHint,
  type ValueInspectorPath,
} from '@tensnap/core/value-inspector';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import * as styles from './ValueInspector.css';

export interface ValueInspectorProps {
  value: unknown;
  renderHint?: ValueInspectorHint;
  /** A compact inspector is suitable for a panel or details dialog. */
  compact?: boolean;
  className?: string;
}

const PAGE_SIZE = 100;
const COLUMN_WIDTH = 160;
const OVERSCAN = 2;
const FALLBACK_VIEWPORT_WIDTH = 640;

type InspectorState = {
  value: unknown;
  path: ValueInspectorPath;
  offset: number;
};

function isInspectableRoot(value: unknown): value is ProtocolData {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return true;
  if (typeof value !== 'object') return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function contentRowCount(content: ValueInspectorContent): number {
  return content.kind === 'tree'
    ? content.entries.length
    : content.kind === 'table'
      ? content.rows.length
      : 0;
}

function visibleRange(
  offset: number,
  viewport: number,
  itemSize: number,
  total: number,
): [number, number] {
  if (total === 0) return [0, 0];
  const start = Math.min(total - 1, Math.max(0, Math.floor(offset / itemSize) - OVERSCAN));
  const end = Math.min(total, Math.ceil((offset + viewport) / itemSize) + OVERSCAN);
  return [start, Math.max(start + 1, end)];
}

function displayValue(value: unknown): string {
  return typeof value === 'string' ? value : valueInspectorText(value, 512).text;
}

/** Pages bound the row count; columns stay virtualized while rows grow to fit full strings. */
function ColumnWindowTable({
  columns,
  rows,
  rowOffset,
}: {
  columns: readonly string[];
  rows: readonly Readonly<Record<string, ProtocolData>>[];
  rowOffset: number;
}) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [scroll, setScroll] = useState({ left: 0, width: FALLBACK_VIEWPORT_WIDTH });
  useEffect(() => {
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0)
        setScroll((current) => ({ ...current, width: entry.contentRect.width }));
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewport]);
  const [columnStart, columnEnd] = visibleRange(
    scroll.left,
    scroll.width,
    COLUMN_WIDTH,
    columns.length,
  );
  const visibleColumns = columns.slice(columnStart, columnEnd);
  const grid = {
    gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(${COLUMN_WIDTH}px, 1fr))`,
  };
  return (
    <ScrollArea
      ref={setViewport}
      className={styles.tableScroll}
      role="region"
      aria-label="Structured value table"
      onScroll={(event) => {
        const target = event.currentTarget;
        setScroll({
          left: target.scrollLeft,
          width: target.clientWidth || FALLBACK_VIEWPORT_WIDTH,
        });
      }}
    >
      <div
        className={styles.virtualTable}
        role="table"
        style={{ width: `max(100%, ${Math.max(COLUMN_WIDTH, columns.length * COLUMN_WIDTH)}px)` }}
      >
        <div className={styles.virtualHeader} role="row" style={grid}>
          {visibleColumns.map((column, index) => (
            <div
              className={styles.virtualHeaderCell}
              role="columnheader"
              key={column}
              style={{ gridColumn: columnStart + index + 1 }}
            >
              {column}
            </div>
          ))}
        </div>
        {rows.map((row, rowIndex) => (
          <div className={styles.virtualRow} role="row" key={rowOffset + rowIndex} style={grid}>
            {visibleColumns.map((column, index) => (
              <div
                className={styles.virtualCell}
                role="cell"
                key={column}
                style={{ gridColumn: columnStart + index + 1 }}
              >
                {displayValue(row[column] ?? null)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

const InspectorContent = memo(function InspectorContent({
  value,
  path,
  offset,
  renderHint,
  compact,
  className,
  onNavigate,
  onPage,
}: {
  value: unknown;
  path: ValueInspectorPath;
  offset: number;
  renderHint: ValueInspectorHint;
  compact: boolean;
  className?: string;
  onNavigate: (path: ValueInspectorPath) => void;
  onPage: (offset: number) => void;
}) {
  const { _ } = useLingui();
  const inspector = useMemo(
    () => (isInspectableRoot(value) ? new Inspector(value) : null),
    [value],
  );
  const content = useMemo(
    () => inspector?.inspect({ path, offset, limit: PAGE_SIZE, hint: renderHint }),
    [inspector, offset, path, renderHint],
  );

  if (!inspector || !content) {
    const raw = valueInspectorText(value);
    return (
      <ScrollArea
        className={[styles.raw, compact && styles.compact, className].filter(Boolean).join(' ')}
      >
        <pre style={{ margin: 0, font: 'inherit', whiteSpace: 'inherit', overflowWrap: 'inherit' }}>
          {raw.text}
        </pre>
      </ScrollArea>
    );
  }

  const rowCount = contentRowCount(content);
  const showPagination = content.kind !== 'text' && (offset > 0 || content.hasMore);

  return (
    <section
      className={[styles.root, compact && styles.compact, className].filter(Boolean).join(' ')}
      aria-label={_(msg`Structured value inspector`)}
    >
      {path.length > 0 && (
        <nav className={styles.breadcrumbs} aria-label={_(msg`Value path`)}>
          <button type="button" className={styles.breadcrumb} onClick={() => onNavigate([])}>
            {_(msg`root`)}
          </button>
          {path.map((segment, index) => (
            <button
              type="button"
              key={`${index}:${segment}`}
              className={styles.breadcrumb}
              onClick={() => onNavigate(path.slice(0, index + 1))}
            >
              {String(segment)}
            </button>
          ))}
        </nav>
      )}
      {content.kind === 'text' && (
        <ScrollArea className={styles.raw}>
          <pre
            style={{ margin: 0, font: 'inherit', whiteSpace: 'inherit', overflowWrap: 'inherit' }}
          >
            {typeof inspector.valueAt(path) === 'string'
              ? (inspector.valueAt(path) as string)
              : content.text}
          </pre>
        </ScrollArea>
      )}
      {content.kind === 'tree' && (
        <ScrollArea className={styles.tree}>
          {content.entries.map((entry) => (
            <div className={styles.treeRow} key={entry.key}>
              <span className={styles.treeKey}>{entry.key}</span>
              {entry.expandable ? (
                <button
                  type="button"
                  className={styles.expandButton}
                  onClick={() => onNavigate(entry.path)}
                >
                  {entry.summary}
                  <ChevronRight size={14} />
                </button>
              ) : (
                <span className={styles.treeValue}>
                  {typeof entry.value === 'string' ? entry.value : entry.summary}
                </span>
              )}
            </div>
          ))}
        </ScrollArea>
      )}
      {content.kind === 'table' && (
        <ColumnWindowTable columns={content.columns} rows={content.rows} rowOffset={offset} />
      )}
      {showPagination && (
        <footer className={styles.pagination}>
          <span>
            {rowCount === 0 ? 0 : offset + 1}–{offset + rowCount}
            {content.total === undefined ? ' / ?' : ` / ${content.total}`}
          </span>
          <button
            type="button"
            aria-label={_(msg`Previous value rows`)}
            disabled={offset === 0}
            onClick={() => onPage(offset - PAGE_SIZE)}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            aria-label={_(msg`Next value rows`)}
            disabled={!content.hasMore}
            onClick={() => onPage(offset + PAGE_SIZE)}
          >
            <ChevronRight size={14} />
          </button>
        </footer>
      )}
      {content.kind === 'text' && content.reason && (
        <p className={styles.notice}>{content.reason}</p>
      )}
    </section>
  );
});

/**
 * React adapter for the framework-neutral core inspector. Incoming values are
 * coalesced before the memoized renderer sees them, so a 60/120 Hz monitor
 * stream cannot rebuild its rows and cells more than once per animation frame.
 */
export function ValueInspector({
  value,
  renderHint = 'auto',
  compact = false,
  className,
}: ValueInspectorProps) {
  const [state, setState] = useState<InspectorState>({ value, path: [], offset: 0 });

  useEffect(() => {
    let frame: number | ReturnType<typeof setTimeout> = 0;
    const isAnimationFrameAvailable = typeof requestAnimationFrame === 'function';
    const update = () => {
      frame = 0;
      setState((previous) => {
        if (Object.is(previous.value, value)) return previous;
        if (!isInspectableRoot(value)) return { value, path: [], offset: 0 };

        const inspector = new Inspector(value);
        const path = inspector.valueAt(previous.path) === undefined ? [] : previous.path;
        if (previous.offset === 0) return { value, path, offset: 0 };

        const content = inspector.inspect({
          path,
          offset: previous.offset,
          limit: PAGE_SIZE,
          hint: renderHint,
        });
        const offset =
          content.kind !== 'text' && contentRowCount(content) === 0 ? 0 : previous.offset;
        return { value, path, offset };
      });
    };
    frame = isAnimationFrameAvailable ? requestAnimationFrame(update) : setTimeout(update, 0);
    return () => {
      if (!frame) return;
      if (isAnimationFrameAvailable) cancelAnimationFrame(frame as number);
      else clearTimeout(frame as ReturnType<typeof setTimeout>);
    };
  }, [renderHint, value]);

  const navigate = useCallback((path: ValueInspectorPath) => {
    setState((previous) => ({ ...previous, path, offset: 0 }));
  }, []);
  const page = useCallback((offset: number) => {
    setState((previous) => ({ ...previous, offset: Math.max(0, offset) }));
  }, []);

  return (
    <InspectorContent
      value={state.value}
      path={state.path}
      offset={state.offset}
      renderHint={renderHint}
      compact={compact}
      className={className}
      onNavigate={navigate}
      onPage={page}
    />
  );
}

export type { ValueInspectorHint, ProtocolData };
