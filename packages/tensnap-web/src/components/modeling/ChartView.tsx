import { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import * as styles from './ChartView.css';
import { ChartGroup, NativeDataPoint } from '@/types/model';
import { createCsvContent } from '@/store/scenario-inst';
import { LeaferChartView } from '@/components/chart';
import type { ChartDataPoint, ChartConfig, LeaferChartViewRef } from '@/components/chart';

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

  // 节流相关状态
  const [displayData, setDisplayData] = useState<Array<NativeDataPoint>>([]);
  const rawDataRef = useRef<Array<NativeDataPoint>>(rawData);
  const lastUpdateTimeRef = useRef<number>(0);
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);
  const chartViewRef = useRef<LeaferChartViewRef>(null);


  // 节流更新函数
  const scheduleUpdate = useCallback(() => {
    if (updateTimerRef.current) {
      return; // 已经有一个更新计划在进行中
    }

    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateTimeRef.current;

    if (timeSinceLastUpdate >= updateInterval || rawDataRef.current.length <= updateNowLengthThreshold) {
      // 可以立即更新
      setDisplayData(rawDataRef.current.slice(- (maxDataPoints ?? rawDataRef.current.length)));
      lastUpdateTimeRef.current = now;
      updateTimerRef.current = null;
    } else {
      // 需要等待
      const remainingTime = updateInterval - timeSinceLastUpdate;
      updateTimerRef.current = setTimeout(() => {
        setDisplayData(rawDataRef.current.slice(- (maxDataPoints ?? rawDataRef.current.length)));
        lastUpdateTimeRef.current = Date.now();
        updateTimerRef.current = null;
      }, remainingTime);
    }
  }, [updateInterval, maxDataPoints]);

  // 持续更新原始数据引用
  useEffect(() => {
    rawDataRef.current = rawData;
    scheduleUpdate();
  }, [rawData, rawData.length, scheduleUpdate]);

  useEffect(() => {
    return () => {
      // 清理定时器
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }
    };
  }, []);

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

  // Build chart configuration from metadata
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

  // Convert display data to chart format
  const chartData: ChartDataPoint[] = useMemo(() => {
    return displayData.map(point => ({ ...point }));
  }, [displayData]);

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
          data={chartData}
          config={chartConfig}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
}