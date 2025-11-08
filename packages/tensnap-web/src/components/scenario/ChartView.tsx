import { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import * as styles from './ChartView.css';
import { ChartGroup, NativeDataPoint } from '@/types/model';
import { createCsvContent } from '@/store/scenario-inst';
import { LeaferChartView } from '@/components/chart';
import type { ChartConfig, LeaferChartViewRef } from '@/components/chart';
import { throttle } from '@/utils/react';

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
  updateInterval?: number; // 最小更新间隔，单位毫秒，默认500ms
  updateNowLengthThreshold?: number; // 立即更新的长度阈值，默认0
  maxDataPoints?: number; // 最大数据点数，默认无限制
}

export function ChartView(props: ChartViewProps) {
  // 缓存处理后的数据和相关状态
  const {
    chartGroup,
    updateInterval = 200,
    updateNowLengthThreshold = 8,
    maxDataPoints = undefined,
  } = props;
  const {
    data: rawData,
  } = chartGroup;

  // 显示数据和缓存
  const [displayData, setDisplayData] = useState<Array<NativeDataPoint>>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const chartViewRef = useRef<LeaferChartViewRef>(null);

  // 缓存上次处理的数据，避免重复slice
  const lastProcessedDataRef = useRef<{
    sourceLength: number;
    maxPoints: number | undefined;
    result: Array<NativeDataPoint>;
  } | null>(null);

  // 优化的数据处理函数
  const processData = useCallback((data: Array<NativeDataPoint>, max: number | undefined): Array<NativeDataPoint> => {
    // 检查缓存是否有效
    const cached = lastProcessedDataRef.current;
    if (cached &&
      cached.sourceLength === data.length &&
      cached.maxPoints === max &&
      cached.result.length > 0) {
      return cached.result;
    }

    // 处理新数据
    const result = max !== undefined && data.length > max
      ? data.slice(-max)
      : data;

    // 更新缓存
    lastProcessedDataRef.current = {
      sourceLength: data.length,
      maxPoints: max,
      result,
    };

    return result;
  }, []);

  // 使用throttle创建节流更新函数
  const throttledUpdateRef = useRef<ReturnType<typeof throttle> | null>(null);

  // 创建节流函数（仅在依赖变化时重建）
  useEffect(() => {
    // 清理旧的throttle函数
    if (throttledUpdateRef.current) {
      throttledUpdateRef.current.cancel();
    }

    // 创建新的throttle函数
    throttledUpdateRef.current = throttle((data: Array<NativeDataPoint>) => {
      const processed = processData(data, maxDataPoints);
      setDisplayData(processed);
      setDataVersion((v) => (v + 1) | 0);
    }, updateInterval);

    return () => {
      // 组件卸载时清理
      if (throttledUpdateRef.current) {
        throttledUpdateRef.current.cancel();
      }
    };
  }, [updateInterval, maxDataPoints, processData, setDisplayData, setDataVersion]);

  // 数据更新处理
  useEffect(() => {
    // 对于小数据量立即更新，大数据量使用节流
    if (rawData.length <= updateNowLengthThreshold) {
      throttledUpdateRef.current?.cancel();
      const processed = processData(rawData, maxDataPoints);
      setDisplayData(processed);
      setDataVersion((v) => (v + 1) | 0);
    } else if (throttledUpdateRef.current) {
      throttledUpdateRef.current(rawData);
    }
  }, [rawData, rawData.length, updateNowLengthThreshold, maxDataPoints, processData]);

  const exportToCSV = useCallback(() => {
    const csvContent = createCsvContent(chartGroup);
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chart_${chartGroup.id}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [chartGroup]);

  const copyToClipboard = useCallback(async () => {
    if (!chartViewRef.current) return;

    try {
      const blob = await chartViewRef.current.getCanvasBlob();
      if (blob) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob }),
        ]);
        alert('Chart copied to clipboard!');
      }
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      alert('Failed to copy to clipboard');
    }
  }, []);

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
    <div className={styles.chartContainer}>
      <div className={styles.buttonContainer}>
        <button
          onClick={exportToCSV}
          className={styles.exportButton}
        >
          Export CSV
        </button>
        <button
          onClick={copyToClipboard}
          className={styles.exportButton}
          style={{ marginLeft: '8px' }}
        >
          Copy Chart
        </button>
      </div>

      <div className={styles.chartViewContainer}>
        <LeaferChartView
          ref={chartViewRef}
          data={displayData}
          dataVersion={dataVersion}
          config={chartConfig}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
}