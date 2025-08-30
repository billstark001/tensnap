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
import { ChartData } from '@/types/modeling';
import * as styles from './ChartView.css';

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
];

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
  chart: ChartData;
  updateInterval?: number; // 最小更新间隔，单位毫秒，默认500ms
}

export function ChartView({ chart, updateInterval = 500 }: ChartViewProps) {
  // 缓存处理后的数据和相关状态
  const processedDataRef = useRef<Array<{ time: number; [key: string]: any }>>([]);
  const timeMapRef = useRef<Map<number, any>>(new Map());
  const lastProcessedLengthRef = useRef<number>(0);
  const currentChartIdRef = useRef<string | null>(null);
  
  // 节流相关状态
  const [displayData, setDisplayData] = useState<Array<{ time: number; [key: string]: any }>>([]);
  const pendingDataRef = useRef<ChartData | null>(null);
  const lastUpdateTimeRef = useRef<number>(0);
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 处理数据的核心逻辑（从useMemo中提取出来）
  const processChartData = useCallback((chartData: ChartData) => {
    if (!chartData) return [];

    // 如果 chart.id 发生变化，清空缓存（新的图表）
    if (currentChartIdRef.current !== chartData.id) {
      processedDataRef.current = [];
      timeMapRef.current = new Map();
      lastProcessedLengthRef.current = 0;
      currentChartIdRef.current = chartData.id;
    }

    const dataPoints = chartData.data;
    const lastProcessedLength = lastProcessedLengthRef.current;
    
    // 如果数据长度变小，说明可能是重置，重新处理所有数据
    if (dataPoints.length < lastProcessedLength) {
      timeMapRef.current.clear();
      processedDataRef.current = [];
      lastProcessedLengthRef.current = 0;
    }

    // 只处理新增的数据点
    const newDataPoints = dataPoints.slice(lastProcessedLength);
    
    if (newDataPoints.length === 0) {
      return processedDataRef.current;
    }

    // 增量更新时间映射
    newDataPoints.forEach((point) => {
      if (!timeMapRef.current.has(point.time)) {
        timeMapRef.current.set(point.time, { time: point.time });
      }
      const entry = timeMapRef.current.get(point.time)!;
      entry[chartData.id] = point.value;
    });

    // 重新构建排序后的数组（只在有新数据时）
    if (newDataPoints.length > 0) {
      processedDataRef.current = Array.from(timeMapRef.current.values())
        .sort((a, b) => a.time - b.time);
    }

    lastProcessedLengthRef.current = dataPoints.length;
    return processedDataRef.current;
  }, []);

  // 节流更新函数
  const scheduleUpdate = useCallback(() => {
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
    }

    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateTimeRef.current;

    if (timeSinceLastUpdate >= updateInterval) {
      // 可以立即更新
      if (pendingDataRef.current) {
        const newData = processChartData(pendingDataRef.current);
        setDisplayData([...newData]);
        lastUpdateTimeRef.current = now;
        pendingDataRef.current = null;
      }
    } else {
      // 需要等待
      const remainingTime = updateInterval - timeSinceLastUpdate;
      updateTimerRef.current = setTimeout(() => {
        if (pendingDataRef.current) {
          const newData = processChartData(pendingDataRef.current);
          setDisplayData([...newData]);
          lastUpdateTimeRef.current = Date.now();
          pendingDataRef.current = null;
        }
      }, remainingTime);
    }
  }, [updateInterval, processChartData]);

  // 当chart数据变化时，触发节流更新
  useEffect(() => {
    if (chart) {
      pendingDataRef.current = chart;
      scheduleUpdate();
    }

    // 清理定时器
    return () => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }
    };
  }, [chart, scheduleUpdate]);

  const data = useMemo(() => displayData, [displayData]);

  const exportToCSV = useCallback(() => {
    if (data.length === 0) return;

    const headers = ['time', chart.label];
    const csvContent = [
      headers.join(','),
      ...data.map(row => {
        const values = [row.time];
        values.push(row[chart.id] || '');
        return values.join(',');
      })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chart_${chart.id}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, chart.id, chart.label]);

  // 获取当前图表的颜色
  const chartColor = useMemo(() => getColorForId(chart.id), [chart.id]);

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
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line
              key={chart.id}
              type="monotone"
              dataKey={chart.id}
              name={chart.label}
              stroke={chart.color || chartColor}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}