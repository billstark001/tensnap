import React from 'react';
import { Trans } from '@lingui/react/macro';
import Form from '@tensnap/web-common/components/ui/Form';
import { AnchoredView } from '@/types/ui';
import { BaseViewFields, BaseViewEditorProps } from './BaseViewEditor';
import * as styles from './EditViews.css';

type EditableEnvironmentData = {
  id: string;
  type: string;
  width?: number;
  height?: number;
  coord_offset?: string;
  show_grid?: boolean;
  background_color?: string;
};

interface EnvironmentViewEditorProps extends BaseViewEditorProps {
  view: AnchoredView;
  objectData: EditableEnvironmentData | null;
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
  const coordOffset = env?.coord_offset === 'float' ? 'float' : 'int';
  const showGrid = env?.show_grid !== false;
  const backgroundColor = typeof env?.background_color === 'string' ? env.background_color : '#ffffff';

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

          {env.type === '2d' && (
            <>
              <Form.FieldGroup columns={2}>
                <Form.Field label={<Trans>Grid Width</Trans>} htmlFor="grid-width">
                  <Form.Input
                    id="grid-width"
                    type="number"
                    min="1"
                    value={env.width ?? 0}
                    onChange={(e) => {
                      const currentWidth = env.width ?? 1;
                      onObjectChange('width', parseIntInput(e.target.value, currentWidth, 1));
                    }}
                  />
                </Form.Field>

                <Form.Field label={<Trans>Grid Height</Trans>} htmlFor="grid-height">
                  <Form.Input
                    id="grid-height"
                    type="number"
                    min="1"
                    value={env.height ?? 0}
                    onChange={(e) => {
                      const currentHeight = env.height ?? 1;
                      onObjectChange('height', parseIntInput(e.target.value, currentHeight, 1));
                    }}
                  />
                </Form.Field>
              </Form.FieldGroup>

              <Form.Field label={<Trans>Agent Coordinate Offset</Trans>} htmlFor="coord-offset">
                <Form.Select
                  id="coord-offset"
                  value={coordOffset}
                  onChange={(e) => onObjectChange('coord_offset', e.target.value)}
                >
                  <option value="int"><Trans>int (cell center +0.5)</Trans></option>
                  <option value="float"><Trans>float (no offset)</Trans></option>
                </Form.Select>
              </Form.Field>

              <Form.FieldGroup columns={2}>
                <Form.Field label={<Trans>Background Color</Trans>} htmlFor="background-color">
                  <Form.Input
                    id="background-color"
                    type="color"
                    value={backgroundColor}
                    onChange={(e) => onObjectChange('background_color', e.target.value)}
                  />
                </Form.Field>

                <Form.Field label={<Trans>Show Grid Lines</Trans>} htmlFor="show-grid">
                  <Form.Select
                    id="show-grid"
                    value={showGrid ? 'true' : 'false'}
                    onChange={(e) => onObjectChange('show_grid', e.target.value === 'true')}
                  >
                    <option value="true"><Trans>Visible</Trans></option>
                    <option value="false"><Trans>Hidden</Trans></option>
                  </Form.Select>
                </Form.Field>
              </Form.FieldGroup>

              <Form.Field label={<Trans>Layers Metadata</Trans>} htmlFor="env-layers-metadata">
                <Form.Textarea
                  id="env-layers-metadata"
                  rows={10}
                  value={JSON.stringify(env, null, 2)}
                  disabled
                  className={styles.disabledField}
                />
              </Form.Field>
            </>
          )}
        </>
      )}
    </>
  );
};
