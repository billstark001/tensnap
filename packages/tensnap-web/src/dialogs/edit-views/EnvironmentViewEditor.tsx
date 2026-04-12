import React from 'react';
import { Trans } from '@lingui/react/macro';
import Form from '@/components/ui/Form';
import { AnchoredView } from '@/types/ui';
import { BaseViewFields, BaseViewEditorProps } from './BaseViewEditor';
import { ScenarioEnvironmentState } from '@tensnap/core';
import * as styles from './EditViews.css';

interface EnvironmentViewEditorProps extends BaseViewEditorProps {
  view: AnchoredView;
  objectData: ScenarioEnvironmentState | null;
  onObjectChange: (field: string, value: any) => void;
}

// Helper function to parse integer input safely
const parseIntInput = (value: string, fallback: number = 0, min?: number): number => {
  if (value === '' || value === '-') {
    return fallback;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    return fallback;
  }
  if (min !== undefined && parsed < min) {
    return min;
  }
  return parsed;
};

export const EnvironmentViewEditor: React.FC<EnvironmentViewEditorProps> = ({ view, objectData: env, onChange, onObjectChange }) => {
  const gridLayer = env ? [...env.layers.values()].find((layer) => layer.layerType === 'grid') : null;
  const gridMetadata = (gridLayer?.metadata ?? {}) as Record<string, any>;

  return (
    <>
      <BaseViewFields view={view} onChange={onChange} />

      <Form.Field label={<Trans>Title</Trans>} htmlFor="env-title">
        <Form.Input
          id="env-title"
          type="text"
          value={view.data.title || ''}
          onChange={(e) => onChange('data.title', e.target.value)}
        />
      </Form.Field>

      {env && (
        <>
          <Form.FieldGroup columns={2}>
            <Form.Field label={<Trans>Environment ID</Trans>} htmlFor="env-id">
              <Form.Input
                id="env-id"
                type="text"
                value={env.id}
                onChange={(e) => onObjectChange('id', e.target.value)}
              />
            </Form.Field>

            <Form.Field label={<Trans>Environment Type</Trans>} htmlFor="env-type">
              <Form.Input
                id="env-type"
                type="text"
                value={env.type}
                disabled
                className={styles.disabledField}
              />
            </Form.Field>
          </Form.FieldGroup>

          <Form.Field label={<Trans>Environment Label</Trans>} htmlFor="env-label">
            <Form.Input
              id="env-label"
              type="text"
              value={view.data.title || ''}
              onChange={(e) => onChange('data.title', e.target.value)}
            />
          </Form.Field>

          {env.type === '2d' && gridLayer && (
            <Form.FieldGroup columns={2}>
              <Form.Field label={<Trans>Grid Width</Trans>} htmlFor="grid-width">
                <Form.Input
                  id="grid-width"
                  type="number"
                  min="1"
                  value={gridMetadata.width ?? 0}
                  onChange={(e) => {
                    const currentWidth = gridMetadata.width ?? 1;
                    onObjectChange('grid.width', parseIntInput(e.target.value, currentWidth, 1));
                  }}
                />
              </Form.Field>

              <Form.Field label={<Trans>Grid Height</Trans>} htmlFor="grid-height">
                <Form.Input
                  id="grid-height"
                  type="number"
                  min="1"
                  value={gridMetadata.height ?? 0}
                  onChange={(e) => {
                    const currentHeight = gridMetadata.height ?? 1;
                    onObjectChange('grid.height', parseIntInput(e.target.value, currentHeight, 1));
                  }}
                />
              </Form.Field>
            </Form.FieldGroup>
          )}
        </>
      )}
    </>
  );
};
