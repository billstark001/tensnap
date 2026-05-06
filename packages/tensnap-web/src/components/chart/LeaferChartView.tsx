import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { LineChartView } from '@tensnap/core/chart/browser';
import type { ChartDataPoint, ChartConfig } from '@tensnap/core';
import { useSettingsStore } from '@/store/settings';
import clsx from 'clsx';
import * as styles from './LeaferChartView.css';

export interface LeaferChartViewProps {
  data: ChartDataPoint[];
  dataVersion?: any;
  config: ChartConfig;
  className?: string;
  style?: React.CSSProperties;
}

export interface LeaferChartViewRef {
  getCanvasBlob: () => Promise<Blob | null>;
}

// React binding for LineChartView.
export const LeaferChartView = forwardRef<LeaferChartViewRef, LeaferChartViewProps>((props, ref) => {
  const { data, dataVersion, config, className, style } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<LineChartView | null>(null);
  const [isReady, setIsReady] = useState(false);
  const theme = useSettingsStore((state) => state.theme);

  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    getCanvasBlob: async () => {
      if (chartRef.current) {
        return chartRef.current.getCanvasBlob();
      }
      return null;
    },
  }));

  // Initialize chart on mount
  useEffect(() => {
    if (containerRef.current && !chartRef.current) {
      chartRef.current = new LineChartView(containerRef.current, config);
      chartRef.current.resize(
        containerRef.current.clientWidth,
        containerRef.current.clientHeight
      );
      setIsReady(true);
    }

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update data when it changes
  useEffect(() => {
    if (isReady && chartRef.current) {
      chartRef.current.updateData(data);
    }
  }, [data, dataVersion, isReady]);

  // Update config when it changes
  useEffect(() => {
    if (isReady && chartRef.current) {
      chartRef.current.updateConfig(config);
    }
  }, [config, isReady]);

  // Update theme when it changes
  useEffect(() => {
    if (isReady && chartRef.current) {
      chartRef.current.updateTheme();
    }
  }, [theme, isReady]);

  // Handle container resize
  useEffect(() => {
    if (!containerRef.current || !isReady) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (chartRef.current && width > 0 && height > 0) {
          chartRef.current.resize(width, height);
        }
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [isReady]);

  return (
    <div
      ref={containerRef}
      className={clsx(styles.chartContainer, className)}
      style={style}
    />
  );
});

LeaferChartView.displayName = 'LeaferChartView';
