import React from 'react';
import { Trans } from '@lingui/react/macro';
import Form from '@tensnap/web-common/components/ui/Form';
import { AnchoredView } from '@/types/ui';
import { BaseViewFields, BaseViewEditorProps } from './BaseViewEditor';
import * as styles from './EditViews.css';
import type { EditableEnvironmentData } from './environment-editor-model';

interface EnvironmentViewEditorProps extends BaseViewEditorProps {
  view: AnchoredView;
  objectData: EditableEnvironmentData | null;
  onObjectChange: (field: string, value: any) => void;
}

const formatMetadataValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value == null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const ReadOnlyMetadataField = ({ id, label, value }: { id: string; label: string; value: unknown }) => {
  const textValue = formatMetadataValue(value);
  if (textValue.length > 60 || textValue.includes('\n')) {
    return (
      <Form.Field label={label} htmlFor={id}>
        <Form.Textarea id={id} rows={Math.min(6, Math.max(3, textValue.split('\n').length))} value={textValue} disabled className={styles.disabledField} />
      </Form.Field>
    );
  }

  return (
    <Form.Field label={label} htmlFor={id}>
      <Form.Input id={id} type="text" value={textValue} disabled className={styles.disabledField} />
    </Form.Field>
  );
};

export const EnvironmentViewEditor: React.FC<EnvironmentViewEditorProps> = ({ view, objectData: env, onChange }) => {
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
                disabled
                className={styles.disabledField}
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

          <Form.Field label={<Trans>Display Type</Trans>} htmlFor="env-display-type">
            <Form.Input
              id="env-display-type"
              type="text"
              value={env.displayType}
              disabled
              className={styles.disabledField}
            />
          </Form.Field>

          {env.type === '2d' && (
            <>
              <Form.FieldSet>
                <Form.Label><Trans>2D Layer Metadata</Trans></Form.Label>
                {env.layers.length > 0 ? env.layers.map((layer) => (
                  <details key={layer.id} open style={{ marginBottom: '12px' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: '8px' }}>
                      {layer.layerType} - {layer.id}
                    </summary>
                    {layer.groups.length > 0 ? layer.groups.map((group) => (
                      <div key={`${layer.id}-${group.title}`} style={{ marginBottom: '12px' }}>
                        <div className={styles.infoText} style={{ marginBottom: '6px', fontWeight: 600 }}>
                          {group.title}
                        </div>
                        {group.entries.map(({ key, value }) => (
                          <ReadOnlyMetadataField
                            key={`${layer.id}-${key}`}
                            id={`env-${layer.id}-${key}`}
                            label={key}
                            value={value}
                          />
                        ))}
                      </div>
                    )) : (
                      <div className={styles.infoText}><Trans>No metadata on this layer.</Trans></div>
                    )}
                  </details>
                )) : (
                  <div className={styles.infoText}><Trans>No layers available.</Trans></div>
                )}
              </Form.FieldSet>
            </>
          )}

          {env.type === 'uniform' && (
            <Form.FieldSet>
              <Form.Label><Trans>Uniform Layer Metadata</Trans></Form.Label>
              {env.layers.length > 0 ? env.layers.map((layer) => (
                <details key={layer.id} open style={{ marginBottom: '12px' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: '8px' }}>
                    {layer.layerType} - {layer.id}
                  </summary>
                  {layer.groups.length > 0 ? layer.groups.map((group) => group.entries.map(({ key, value }) => (
                    <ReadOnlyMetadataField
                      key={`${layer.id}-${key}`}
                      id={`env-${layer.id}-${key}`}
                      label={key}
                      value={value}
                    />
                  ))) : (
                    <div className={styles.infoText}><Trans>No metadata on this layer.</Trans></div>
                  )}
                </details>
              )) : (
                <div className={styles.infoText}><Trans>No layers available.</Trans></div>
              )}
            </Form.FieldSet>
          )}
        </>
      )}
    </>
  );
};
