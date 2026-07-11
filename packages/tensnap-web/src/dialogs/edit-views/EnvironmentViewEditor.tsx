import React, { useState } from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import Form from '@tensnap/web-common/components/ui/Form';
import * as Select from '@tensnap/web-common/components/ui/Select';
import { AnchoredView } from '@/types/ui';
import { BaseViewFields, BaseViewEditorProps } from './BaseViewEditor';
import * as styles from './EditViews.css';
import type { EditableEnvironmentData } from './environment-editor-model';
import { ObjectIdentityField } from './ObjectIdentityField';
import { useToast } from '@/store/toast';

interface EnvironmentViewEditorProps extends BaseViewEditorProps {
  view: AnchoredView;
  objectData: EditableEnvironmentData | null;
  onObjectChange: (field: string, value: any) => void;
  onEditObjectId: () => void;
  onRequestTypeChange: (type: EditableEnvironmentData['type']) => void;
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

const parseNumberInput = (value: string, fallback: number): number => {
  if (value === '' || value === '-') {
    return fallback;
  }
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const MetadataValueField: React.FC<{
  id: string;
  label: string;
  value: unknown;
  editable: boolean;
  onChange: (value: unknown) => void;
}> = ({ id, label, value, editable, onChange }) => {
  const { _ } = useLingui();
  const toast = useToast();
  const [jsonDraft, setJsonDraft] = useState(() => formatMetadataValue(value));

  if (!editable) {
    return <ReadOnlyMetadataField id={id} label={label} value={value} />;
  }

  if (typeof value === 'boolean') {
    return (
      <Form.FieldSet>
        <Form.Label htmlFor={id} className={styles.checkboxLabel}>
          <input
            id={id}
            type="checkbox"
            checked={value}
            onChange={(event) => onChange(event.target.checked)}
            className={styles.checkboxInput}
          />
          {label}
        </Form.Label>
      </Form.FieldSet>
    );
  }

  if (typeof value === 'number') {
    return (
      <Form.Field label={label} htmlFor={id}>
        <Form.Input
          id={id}
          type="number"
          value={value}
          onChange={(event) => onChange(parseNumberInput(event.target.value, value))}
        />
      </Form.Field>
    );
  }

  if (typeof value === 'string') {
    return (
      <Form.Field label={label} htmlFor={id}>
        <Form.Input
          id={id}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </Form.Field>
    );
  }

  return (
    <Form.Field label={label} htmlFor={id}>
      <Form.Textarea
        id={id}
        rows={Math.min(8, Math.max(3, jsonDraft.split('\n').length))}
        value={jsonDraft}
        onChange={(event) => setJsonDraft(event.target.value)}
        onBlur={() => {
          try {
            onChange(jsonDraft.trim() === '' ? null : JSON.parse(jsonDraft));
          } catch (error) {
            toast.error(_(msg`Invalid JSON`), error instanceof Error ? error.message : String(error));
          }
        }}
      />
    </Form.Field>
  );
};

export const EnvironmentViewEditor: React.FC<EnvironmentViewEditorProps> = ({
  view,
  objectData: env,
  onChange,
  onObjectChange,
  onEditObjectId,
  onRequestTypeChange,
}) => {
  const updateLayerMetadata = (layerIndex: number, key: string, value: unknown) => {
    if (!env) {
      return;
    }
    const layer = env.layers[layerIndex];
    onObjectChange(`layers.${layerIndex}`, {
      ...layer,
      metadata: {
        ...layer.metadata,
        [key]: value,
      },
      groups: layer.groups.map((group) => ({
        ...group,
        entries: group.entries.map((entry) => (
          entry.key === key ? { ...entry, value } : entry
        )),
      })),
    });
  };

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

      <ObjectIdentityField
        label={<Trans>Environment ID</Trans>}
        value={env?.id ?? view.data.id ?? ''}
        objectExists={Boolean(env)}
        onEdit={onEditObjectId}
      />

      {env ? (
        <>
          <Form.FieldGroup columns={2}>
            <Form.Field label={<Trans>Environment Type</Trans>} htmlFor="env-type">
              <Select.Root
                value={env.type}
                onValueChange={(value) => onRequestTypeChange(value as EditableEnvironmentData['type'])}
                triggerClassName={styles.selectTrigger}
              >
                <Select.Viewport>
                  <Select.Item value="2d" indicator>2D</Select.Item>
                  <Select.Item value="uniform" indicator>Uniform</Select.Item>
                </Select.Viewport>
              </Select.Root>
            </Form.Field>

            <Form.Field label={<Trans>Display Type</Trans>} htmlFor="env-display-type">
              <Form.Input
                id="env-display-type"
                type="text"
                value={env.displayType}
                disabled
                className={styles.disabledField}
              />
            </Form.Field>
          </Form.FieldGroup>

          {env.type === '2d' && (
            <>
              <Form.FieldSet>
                <Form.Label><Trans>2D Layer Metadata</Trans></Form.Label>
                {env.layers.length > 0 ? env.layers.map((layer, layerIndex) => (
                  <details key={layer.id} open style={{ marginBottom: '12px' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: '8px' }}>
                      {layer.layerType} - {layer.id}
                    </summary>
                    {layer.groups.length > 0 ? layer.groups.map((group) => (
                      <div key={`${layer.id}-${group.title}`} style={{ marginBottom: '12px' }}>
                        <div className={styles.infoText} style={{ marginBottom: '6px', fontWeight: 600 }}>
                          {group.title}
                        </div>
                        {group.entries.map(({ key, value, editable }) => {
                          const valueKey = value != null && typeof value === 'object' ? formatMetadataValue(value) : '';
                          return (
                            <MetadataValueField
                              key={`${layer.id}-${key}-${valueKey}`}
                              id={`env-${layer.id}-${key}`}
                              label={key}
                              value={value}
                              editable={editable}
                              onChange={(nextValue) => updateLayerMetadata(layerIndex, key, nextValue)}
                            />
                          );
                        })}
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
              {env.layers.length > 0 ? env.layers.map((layer, layerIndex) => (
                <details key={layer.id} open style={{ marginBottom: '12px' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: '8px' }}>
                    {layer.layerType} - {layer.id}
                  </summary>
                  {layer.groups.length > 0 ? layer.groups.map((group) => group.entries.map(({ key, value, editable }) => {
                    const valueKey = value != null && typeof value === 'object' ? formatMetadataValue(value) : '';
                    return (
                      <MetadataValueField
                        key={`${layer.id}-${key}-${valueKey}`}
                        id={`env-${layer.id}-${key}`}
                        label={key}
                        value={value}
                        editable={editable}
                        onChange={(nextValue) => updateLayerMetadata(layerIndex, key, nextValue)}
                      />
                    );
                  })) : (
                    <div className={styles.infoText}><Trans>No metadata on this layer.</Trans></div>
                  )}
                </details>
              )) : (
                <div className={styles.infoText}><Trans>No layers available.</Trans></div>
              )}
            </Form.FieldSet>
          )}
        </>
      ) : (
        <div className={styles.infoText}>
          <Trans>This view can keep its binding, but there is no registered environment to edit.</Trans>
        </div>
      )}
    </>
  );
};
