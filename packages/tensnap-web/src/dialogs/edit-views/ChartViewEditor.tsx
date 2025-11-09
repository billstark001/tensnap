import React, { useState } from 'react';
import { Trans } from '@lingui/react/macro';
import Form from '@/components/ui/Form';
import { AnchoredView } from '@/types/ui';
import { BaseViewFields, BaseViewEditorProps } from './BaseViewEditor';
import { useScenarioStore } from '@/store/scenario/store';
import * as styles from './EditViews.css';

interface ChartViewEditorProps extends BaseViewEditorProps {
  view: AnchoredView;
}

export const ChartViewEditor: React.FC<ChartViewEditorProps> = ({ view, onChange }) => {
  const charts = useScenarioStore((store) => store.charts);
  const updateChartProps = useScenarioStore((store) => store.updateChartProps);
  const updateChartMetadata = useScenarioStore((store) => store.updateChartMetadata);
  
  const chartGroup = charts?.allChartGroups.get(view.data.id);
  const metadataList = chartGroup ? Object.values(chartGroup.metadataDict) : [];

  const [editingMetadataId, setEditingMetadataId] = useState<string | null>(null);

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
          <Form.FieldGroup columns={2}>
            <Form.Field label={<Trans>Chart Group ID</Trans>} htmlFor="chart-id">
              <Form.Input
                id="chart-id"
                type="text"
                value={chartGroup.id}
                disabled
                className={styles.disabledField}
              />
            </Form.Field>

            <Form.Field label={<Trans>Data Points</Trans>} htmlFor="data-points">
              <Form.Input
                id="data-points"
                type="text"
                value={`${chartGroup.data.length} ${chartGroup.data.length === 1 ? 'point' : 'points'}`}
                disabled
                className={styles.disabledField}
              />
            </Form.Field>
          </Form.FieldGroup>

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
            <Form.Label>
              <Trans>Chart Series</Trans> ({metadataList.length})
            </Form.Label>
            {metadataList.length > 0 ? (
              <div className={styles.seriesList}>
                {metadataList.map((meta) => (
                  <div key={meta.id} className={styles.seriesItem}>
                    {meta.color && (
                      <div 
                        className={styles.seriesColor}
                        style={{ backgroundColor: meta.color }}
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {editingMetadataId === meta.id ? (
                        <Form.Input
                          type="text"
                          value={meta.label}
                          onChange={(e) => {
                            if (updateChartMetadata) {
                              updateChartMetadata(meta.id, { label: e.target.value });
                            }
                          }}
                          onBlur={() => setEditingMetadataId(null)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === 'Escape') {
                              setEditingMetadataId(null);
                            }
                          }}
                          autoFocus
                          style={{ padding: '2px 4px', fontSize: '0.875rem' }}
                        />
                      ) : (
                        <span 
                          className={styles.seriesLabel}
                          onClick={() => setEditingMetadataId(meta.id)}
                          style={{ cursor: 'pointer' }}
                          title="Click to edit"
                        >
                          {meta.label}
                        </span>
                      )}
                      <span className={styles.seriesId}> ({meta.id})</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.infoText}>
                <Trans>No series available</Trans>
              </div>
            )}
          </Form.FieldSet>
        </>
      )}
    </>
  );
};
