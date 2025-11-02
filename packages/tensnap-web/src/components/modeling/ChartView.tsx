import { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import * as styles from './ChartView.css';
import { ChartGroup, NativeDataPoint } from '@/types/model';
import { createCsvContent } from '@/store/scenario-inst';

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
  maxDataPoints?: number; // 最大数据点数，默认无限制
}

export function ChartView(props: ChartViewProps) {
  // 缓存处理后的数据和相关状态
  const { 
    chartGroup, 
    updateInterval = 500, 
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


  // 节流更新函数
  const scheduleUpdate = useCallback(() => {
    if (updateTimerRef.current) {
      return; // 已经有一个更新计划在进行中
    }

    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateTimeRef.current;

    if (timeSinceLastUpdate >= updateInterval) {
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
  }, [updateInterval]);

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
  }, [rawDataRef.current, chartGroup.id, chartGroup.label]);

  // 获取当前图表的颜色
  const chartColor = useMemo(() => getColorForId(chartGroup.id), [chartGroup.id]);

  return (
    <div className={styles.chartContainer}>
      <div className={styles.buttonContainer}>
        <button
          onClick={exportToCSV}
          className={styles.exportButton}
        >
          Export CSV
        </button>
      </div>

      <div className={styles.chartViewContainer}>
        <ResponsiveContainer>
          <LineChart data={displayData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis />
            <Tooltip />
            <Legend />
            {Object.values(chartGroup.metadataDict).map((chart) => <Line
              key={chart.id}
              type="monotone"
              dataKey={chart.id}
              name={chart.label}
              stroke={chart.color || chartColor}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}