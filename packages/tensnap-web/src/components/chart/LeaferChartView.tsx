import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { LeaferLineChart } from './LeaferLineChart';
import { ChartDataPoint, ChartConfig } from './types';

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

// React binding for LeaferLineChart
export const LeaferChartView = forwardRef<LeaferChartViewRef, LeaferChartViewProps>((props, ref) => {
  const { data, dataVersion, config, className, style } = props;
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
  }, [data, dataVersion, isReady]);

  // Update config when it changes
  useEffect(() => {
    if (isReady && chartRef.current) {
      chartRef.current.updateConfig(config);
    }
  }, [config, isReady]);

  // Handle container resize
  useEffect(() => {
    if (!isReady || !chartRef.current || !containerRef.current) return;

    let isCleanedUp = false;
    const chartInstance = chartRef.current;
    const containerElement = containerRef.current;

    const resizeObserver = new ResizeObserver(entries => {
      // Prevent callback execution after cleanup
      if (isCleanedUp) return;
      
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (chartInstance && width > 0 && height > 0) {
          chartInstance.resize(width, height);
        }
      }
    });

    resizeObserver.observe(containerElement);

    return () => {
      isCleanedUp = true;
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
