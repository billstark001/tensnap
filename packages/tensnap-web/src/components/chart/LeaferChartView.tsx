import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { LeaferLineChart } from './LeaferLineChart';
import { ChartDataPoint, ChartConfig } from './types';

export interface LeaferChartViewProps {
  data: ChartDataPoint[];
  config: ChartConfig;
  className?: string;
  style?: React.CSSProperties;
}

export interface LeaferChartViewRef {
  getCanvasBlob: () => Promise<Blob | null>;
}

// React binding for LeaferLineChart
export const LeaferChartView = forwardRef<LeaferChartViewRef, LeaferChartViewProps>((props, ref) => {
  const { data, config, className, style } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<LeaferLineChart | null>(null);
  const [isReady, setIsReady] = useState(false);

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
      chartRef.current = new LeaferLineChart(containerRef.current, config);
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
  }, [data, isReady]);

  // Update config when it changes
  useEffect(() => {
    if (isReady && chartRef.current) {
      chartRef.current.updateConfig(config);
    }
  }, [config, isReady]);

  // Handle container resize
  useEffect(() => {
    if (!isReady || !chartRef.current || !containerRef.current) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (chartRef.current && width > 0 && height > 0) {
          chartRef.current.resize(width, height);
        }
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isReady]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: config.width,
        height: config.height,
        ...style,
      }}
    />
  );
});
