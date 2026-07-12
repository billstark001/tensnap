import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { BrowserChartView } from '@tensnap/core/chart/browser';
import type { ChartDataPoint, ChartConfig } from '@tensnap/core';
import { useSettingsStore } from '@/store/settings';
import clsx from 'clsx';
import * as styles from './CanvasChartView.css';

export interface CanvasChartViewProps {
  data: ChartDataPoint[];
  dataVersion?: unknown;
  config: ChartConfig;
  className?: string;
  style?: React.CSSProperties;
}

export interface CanvasChartViewRef {
  getCanvasBlob: () => Promise<Blob | null>;
}

/** React browser host for the DOM-free core ChartScene. */
export const CanvasChartView = forwardRef<CanvasChartViewRef, CanvasChartViewProps>((props, ref) => {
  const { data, dataVersion, config, className, style } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<BrowserChartView | null>(null);
  const [isReady, setIsReady] = useState(false);
  const theme = useSettingsStore((state) => state.theme);

  useImperativeHandle(ref, () => ({
    getCanvasBlob: async () => chartRef.current?.getCanvasBlob() ?? null,
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = new BrowserChartView(container, config);
    chartRef.current = chart;
    chart.resize(container.clientWidth, container.clientHeight);
    setIsReady(true);
    return () => {
      chart.destroy();
      chartRef.current = null;
    };
    // The host is intentionally constructed once; later config changes update the scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isReady) chartRef.current?.updateData(data);
  }, [data, dataVersion, isReady]);

  useEffect(() => {
    if (isReady) chartRef.current?.updateConfig(config);
  }, [config, isReady]);

  useEffect(() => {
    if (isReady) chartRef.current?.updateTheme(theme);
  }, [theme, isReady]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isReady) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) chartRef.current?.resize(width, height);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [isReady]);

  return <div ref={containerRef} className={clsx(styles.chartContainer, className)} style={style} />;
});

CanvasChartView.displayName = 'CanvasChartView';
