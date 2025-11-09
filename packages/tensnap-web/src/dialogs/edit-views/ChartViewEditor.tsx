import React from 'react';
import { Trans } from '@lingui/react/macro';
import Form from '@/components/ui/Form';
import { AnchoredView } from '@/types/ui';
import { BaseViewFields, BaseViewEditorProps } from './BaseViewEditor';
import { useScenarioStore } from '@/store/scenario/store';

interface ChartViewEditorProps extends BaseViewEditorProps {
  view: AnchoredView;
}

export const ChartViewEditor: React.FC<ChartViewEditorProps> = ({ view, onChange }) => {
  const charts = useScenarioStore((store) => store.charts);
  const updateChartProps = useScenarioStore((store) => store.updateChartProps);
  
  const chartGroup = charts?.allChartGroups.get(view.data.id);
  const metadataList = chartGroup ? Object.values(chartGroup.metadataDict) : [];

  return (
    <>
      <BaseViewFields view={view} onChange={onChange} />

      <Form.Field label={<Trans>Title</Trans>} htmlFor="chart-title">
        <Form.Input
          id="chart-title"
          type="text"
          value={view.data.title || ''}
          onChange={(e) => onChange('data.title', e.target.value)}
        />
      </Form.Field>

      {chartGroup && (
        <>
          <Form.Field label={<Trans>Chart Group ID</Trans>} htmlFor="chart-id">
            <Form.Input
              id="chart-id"
              type="text"
              value={chartGroup.id}
              disabled
              style={{ opacity: 0.6, cursor: 'not-allowed' }}
            />
          </Form.Field>

          <Form.Field label={<Trans>Chart Group Label</Trans>} htmlFor="chart-label">
            <Form.Input
              id="chart-label"
              type="text"
              value={chartGroup.label}
              onChange={(e) => {
                if (updateChartProps) {
                  updateChartProps(chartGroup.id, { label: e.target.value });
                }
              }}
            />
          </Form.Field>

          <Form.FieldSet>
            <Form.Label><Trans>Metadata Count</Trans></Form.Label>
            <div style={{ fontSize: '0.875rem', color: 'var(--color-foreground)', opacity: 0.7 }}>
              {metadataList.length} {metadataList.length === 1 ? 'series' : 'series'}
            </div>
          </Form.FieldSet>

          {metadataList.length > 0 && (
            <Form.FieldSet>
              <Form.Label><Trans>Chart Series</Trans></Form.Label>
              <div style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                gap: '4px',
                fontSize: '0.875rem',
                maxHeight: '200px',
                overflowY: 'auto',
                padding: '8px',
                border: '1px solid rgba(0, 0, 0, 0.1)',
                borderRadius: '4px'
              }}>
                {metadataList.map((meta) => (
                  <div key={meta.id} style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px',
                    padding: '4px'
                  }}>
                    {meta.color && (
                      <div style={{
                        width: '12px',
                        height: '12px',
                        borderRadius: '2px',
                        backgroundColor: meta.color,
                        flexShrink: 0
                      }} />
                    )}
                    <span style={{ fontWeight: 500 }}>{meta.label}</span>
                    <span style={{ opacity: 0.6, fontSize: '0.75rem' }}>({meta.id})</span>
                  </div>
                ))}
              </div>
            </Form.FieldSet>
          )}

          <Form.FieldSet>
            <Form.Label><Trans>Data Points</Trans></Form.Label>
            <div style={{ fontSize: '0.875rem', color: 'var(--color-foreground)', opacity: 0.7 }}>
              {chartGroup.data.length} {chartGroup.data.length === 1 ? 'point' : 'points'}
            </div>
          </Form.FieldSet>
        </>
      )}
    </>
  );
};
