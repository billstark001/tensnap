import { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import * as styles from './ChartView.css';
import { ChartGroup, ChartSeriesPoint } from '@/types/model';
import { CanvasChartView } from '@/components/chart';
import type { ChartConfig, CanvasChartViewRef } from '@/components/chart';
import { throttle } from '@tensnap/web-common/react';

// 预定义颜色数组作为模块顶层常量
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
  '#6c5ce7'
] as const;

// 简单的字符串哈希函数
const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 转换为32位整数
  }
  return Math.abs(hash);
};

// 根据ID获取颜色
const getColorForId = (id: string): string => {
  const hash = hashString(id);
  return CHART_COLORS[hash % CHART_COLORS.length];
};

interface ChartViewProps {
  chartGroup: ChartGroup;
  updateTrigger?: number;
  updateInterval?: number; // 最小更新间隔，单位毫秒，默认500ms
  updateNowLengthThreshold?: number; // 立即更新的长度阈值，默认0
  maxDataPoints?: number; // 最大数据点数，默认无限制
}

export function ChartView(props: ChartViewProps) {
  // 缓存处理后的数据和相关状态
  const {
    chartGroup,
    updateTrigger,
    updateInterval = 200,
    updateNowLengthThreshold = 8,
    maxDataPoints = undefined,
  } = props;
  const {
    data: rawData,
  } = chartGroup;

  // 显示数据和缓存
  const [displayData, setDisplayData] = useState<Array<ChartSeriesPoint>>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const chartViewRef = useRef<CanvasChartViewRef>(null);

  // 缓存上次处理的数据，避免重复slice
  const lastProcessedDataRef = useRef<{
    source: Array<ChartSeriesPoint>;
    sourceLength: number;
    maxPoints: number | undefined;
    updateTrigger: number | undefined;
    result: Array<ChartSeriesPoint>;
  } | null>(null);

  // 优化的数据处理函数 - 使用ref避免闭包泄漏
  const processData = useCallback((data: Array<ChartSeriesPoint>, max: number | undefined, revision: number | undefined): Array<ChartSeriesPoint> => {
    // 检查缓存是否有效
    const cached = lastProcessedDataRef.current;
    if (cached &&
      cached.source === data &&
      cached.sourceLength === data.length &&
      cached.maxPoints === max &&
      cached.updateTrigger === revision &&
      cached.result.length > 0) {
      return cached.result;
    }

    // 处理新数据
    const result = max !== undefined && data.length > max
      ? data.slice(-max)
      : data;

    // 更新缓存
    lastProcessedDataRef.current = {
      source: data,
      sourceLength: data.length,
      maxPoints: max,
      updateTrigger: revision,
      result,
    };

    return result;
  }, []); // 移除不必要的依赖，使用ref保证数据新鲜度

  // 使用throttle创建节流更新函数
  const throttledUpdateRef = useRef<ReturnType<typeof throttle> | null>(null);
  
  // 使用ref存储最新的maxDataPoints避免闭包问题
  const maxDataPointsRef = useRef(maxDataPoints);
  useEffect(() => {
    maxDataPointsRef.current = maxDataPoints;
  }, [maxDataPoints]);

  // 创建节流函数（仅在updateInterval变化时重建）
  useEffect(() => {
    // 清理旧的throttle函数
    if (throttledUpdateRef.current) {
      throttledUpdateRef.current.cancel();
      throttledUpdateRef.current = null;
    }

    // 创建新的throttle函数 - 移除processData依赖避免频繁重建
    throttledUpdateRef.current = throttle((data: Array<ChartSeriesPoint>, revision?: number) => {
      const processed = processData(data, maxDataPointsRef.current, revision);
      setDisplayData(processed);
      setDataVersion((v) => (v + 1) | 0);
    }, updateInterval);

    return () => {
      // 组件卸载时清理
      if (throttledUpdateRef.current) {
        throttledUpdateRef.current.cancel();
        throttledUpdateRef.current = null;
      }
    };
  }, [updateInterval, processData]); // 移除不必要的setState依赖

  // 数据更新处理
  useEffect(() => {
    // 对于小数据量立即更新，大数据量使用节流
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
  }, [rawData, rawData.length, updateNowLengthThreshold, maxDataPoints, processData, updateTrigger]);

  // Build chart configuration from metadata (稳定化依赖)
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
