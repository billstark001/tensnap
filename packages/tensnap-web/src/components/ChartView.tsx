import { useMemo, useCallback } from 'react';
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
import { ChartData } from '../types';

interface ChartViewProps {
  charts: ChartData[];
}

export function ChartView({ charts }: ChartViewProps) {
  const data = useMemo(() => {
    if (charts.length === 0) return [];
    
    // Combine all chart data points by time
    const timeMap = new Map<number, any>();
    
    charts.forEach((chart) => {
      chart.data.forEach((point) => {
        if (!timeMap.has(point.time)) {
          timeMap.set(point.time, { time: point.time });
        }
        const entry = timeMap.get(point.time);
        entry[chart.id] = point.value;
      });
    });
    
    return Array.from(timeMap.values()).sort((a, b) => a.time - b.time);
  }, [charts]);
  
  const exportToCSV = useCallback(() => {
    if (data.length === 0) return;
    
    const headers = ['time', ...charts.map(c => c.label)];
    const csvContent = [
      headers.join(','),
      ...data.map(row => {
        const values = [row.time];
        charts.forEach(chart => {
          values.push(row[chart.id] || '');
        });
        return values.join(',');
      })
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chart-data-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, charts]);
  
  const colors = [
    '#8884d8',
    '#82ca9d',
    '#ffc658',
    '#ff7c7c',
    '#8dd1e1',
    '#d084d0',
    '#ffb347',
    '#67b7dc',
  ];
  
  return (
    <div>
      <div style={{ marginBottom: '10px' }}>
        <button
          onClick={exportToCSV}
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            background: '#f0f0f0',
            border: '1px solid #ddd',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Export CSV
        </button>
      </div>
      
      <div style={{ width: '100%', height: '300px' }}>
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis />
            <Tooltip />
            <Legend />
            {charts.map((chart, index) => (
              <Line
                key={chart.id}
                type="monotone"
                dataKey={chart.id}
                name={chart.label}
                stroke={chart.color || colors[index % colors.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}