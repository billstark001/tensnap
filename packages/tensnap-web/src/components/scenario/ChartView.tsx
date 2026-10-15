import { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import * as styles from './ChartView.css';
import { ChartGroup, ChartSeriesPoint } from '@/types/model';
import { CanvasChartView } from '@/components/chart';
import type { ChartConfig, CanvasChartViewRef } from '@/components/chart';
import { throttle } from '@tensnap/web-common/react';

const CHART_COLORS = [
  '#8884d8',
  '#82ca9d',
  '#ffc658',
  '#ff7c7c',
  '#8dd1e1',
  '#d084d0',
  '#ffb347',
  '#67b7dc',
  '#ff6b6b',
  '#4ecdc4',
  '#45b7d1',
  '#96ceb4',
  '#ffeaa7',
  '#dda0dd',
  '#98d8c8',
  '#6c5ce7',
] as const;

const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Coerce the hash to a signed 32-bit integer.
  }
  return Math.abs(hash);
};

const getColorForId = (id: string): string => {
  const hash = hashString(id);
  return CHART_COLORS[hash % CHART_COLORS.length];
};

interface ChartViewProps {
  chartGroup: ChartGroup;
  updateTrigger?: number;
  updateInterval?: number; // Throttle interval in milliseconds; defaults to 200.
  updateNowLengthThreshold?: number; // Update immediately at or below this point count; defaults to 8.
  maxDataPoints?: number; // Maximum displayed points; undefined keeps all points.
}

export function ChartView(props: ChartViewProps) {
  const {
    chartGroup,
    updateTrigger,
    updateInterval = 200,
    updateNowLengthThreshold = 8,
    maxDataPoints = undefined,
  } = props;
  const { data: rawData } = chartGroup;

  const [displayData, setDisplayData] = useState<Array<ChartSeriesPoint>>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const chartViewRef = useRef<CanvasChartViewRef>(null);

  // Reuse the processed array when the source, length, limit, and revision are unchanged.
  const lastProcessedDataRef = useRef<{
    source: Array<ChartSeriesPoint>;
    sourceLength: number;
    maxPoints: number | undefined;
    updateTrigger: number | undefined;
    result: Array<ChartSeriesPoint>;
  } | null>(null);

  const processData = useCallback(
    (
      data: Array<ChartSeriesPoint>,
      max: number | undefined,
      revision: number | undefined,
    ): Array<ChartSeriesPoint> => {
      const cached = lastProcessedDataRef.current;
      if (
        cached &&
        cached.source === data &&
        cached.sourceLength === data.length &&
        cached.maxPoints === max &&
        cached.updateTrigger === revision &&
        cached.result.length > 0
      ) {
        return cached.result;
      }

      const result = max !== undefined && data.length > max ? data.slice(-max) : data;

      lastProcessedDataRef.current = {
        source: data,
        sourceLength: data.length,
        maxPoints: max,
        updateTrigger: revision,
        result,
      };

      return result;
    },
    [],
  );

  const throttledUpdateRef = useRef<ReturnType<typeof throttle> | null>(null);

  // Let pending throttled work read the latest point limit.
  const maxDataPointsRef = useRef(maxDataPoints);
  useEffect(() => {
    maxDataPointsRef.current = maxDataPoints;
  }, [maxDataPoints]);

  useEffect(() => {
    if (throttledUpdateRef.current) {
      throttledUpdateRef.current.cancel();
      throttledUpdateRef.current = null;
    }

    throttledUpdateRef.current = throttle((data: Array<ChartSeriesPoint>, revision?: number) => {
      const processed = processData(data, maxDataPointsRef.current, revision);
      setDisplayData(processed);
      setDataVersion((v) => (v + 1) | 0);
    }, updateInterval);

    return () => {
      if (throttledUpdateRef.current) {
        throttledUpdateRef.current.cancel();
        throttledUpdateRef.current = null;
      }
    };
  }, [updateInterval, processData]);

  useEffect(() => {
    // Update small datasets immediately and throttle larger ones.
    if (rawData.length <= updateNowLengthThreshold) {
      throttledUpdateRef.current?.cancel();
      const processed = processData(rawData, maxDataPoints, updateTrigger);
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) {
          return;
        }
        setDisplayData(processed);
        setDataVersion((v) => (v + 1) | 0);
      });

      return () => {
        cancelled = true;
      };
    }
    throttledUpdateRef.current?.(rawData, updateTrigger);
    return undefined;
  }, [
    rawData,
    rawData.length,
    updateNowLengthThreshold,
    maxDataPoints,
    processData,
    updateTrigger,
  ]);

  const chartConfig: ChartConfig = useMemo(() => {
    const lines = Object.values(chartGroup.metadataDict).map((chart) => ({
      key: chart.id,
      name: chart.label,
      color: chart.color || getColorForId(chart.id),
      strokeWidth: 2,
    }));

    return {
      width: 800,
      height: 300,
      lines,
      showGrid: true,
      showXAxis: true,
      showYAxis: true,
      showLegend: true,
      showTooltip: true,
      smartAxisBounds: false, // Can be enabled via props if needed
      xAxisLabel: 'Time',
      yAxisLabel: 'Value',
      showXAxisLabel: false,
      showYAxisLabel: false,
    };
  }, [chartGroup.metadataDict]);

  return (
    <div className={styles.chartViewContainer}>
      <CanvasChartView
        ref={chartViewRef}
        data={displayData}
        dataVersion={dataVersion}
        config={chartConfig}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}
