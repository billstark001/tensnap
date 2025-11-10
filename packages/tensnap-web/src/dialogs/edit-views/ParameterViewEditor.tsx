import React from 'react';
import { Trans } from '@lingui/react/macro';
import Form from '@/components/ui/Form';
import { AnchoredView } from '@/types/ui';
import { BaseViewFields, BaseViewEditorProps } from './BaseViewEditor';
import { Parameter } from '@/types/model';
import * as styles from './EditViews.css';
import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';

interface ParameterViewEditorProps extends BaseViewEditorProps {
  view: AnchoredView;
  objectData: Parameter | null;
  onObjectChange: (field: string, value: any) => void;
}

// Helper function to parse number input safely
const parseNumberInput = (value: string, fallback: number = 0): number => {
  if (value === '' || value === '-') {
    return fallback;
  }
  const parsed = parseFloat(value);
  return isNaN(parsed) ? fallback : parsed;
};

export const ParameterViewEditor: React.FC<ParameterViewEditorProps> = ({ view, objectData: param, onChange, onObjectChange }) => {
  return (
    <>
      <BaseViewFields view={view} onChange={onChange} />

      <Form.Field label={<Trans>Title</Trans>} htmlFor="param-title">
        <Form.Input
          id="param-title"
          type="text"
          value={view.data.title || ''}
          onChange={(e) => onChange('data.title', e.target.value)}
        />
      </Form.Field>

      {param && (
        <>
          <Form.FieldGroup columns={2}>
            <Form.Field label={<Trans>Parameter ID</Trans>} htmlFor="param-id">
              <Form.Input
                id="param-id"
                type="text"
                value={param.id}
                onChange={(e) => onObjectChange('id', e.target.value)}
              />
            </Form.Field>

            <Form.Field label={<Trans>Parameter Type</Trans>} htmlFor="param-type">
              <Select.Root value={param.type} onValueChange={(value) => onObjectChange('type', value)}>
                <Select.Trigger className={styles.selectTrigger}>
                  <Select.Value />
                  <Select.Icon>
                    <ChevronDown size={16} />
                  </Select.Icon>
                </Select.Trigger>
                <Select.Portal>
                  <Select.Content className={styles.selectContent}>
                    <Select.Viewport>
                      <Select.Item value="number" className={styles.selectItem}>
                        <Select.ItemText>Number</Select.ItemText>
                        <Select.ItemIndicator className={styles.selectItemIndicator}>
                          <Check size={16} />
                        </Select.ItemIndicator>
                      </Select.Item>
                      <Select.Item value="enum" className={styles.selectItem}>
                        <Select.ItemText>Enum</Select.ItemText>
                        <Select.ItemIndicator className={styles.selectItemIndicator}>
                          <Check size={16} />
                        </Select.ItemIndicator>
                      </Select.Item>
                      <Select.Item value="boolean" className={styles.selectItem}>
                        <Select.ItemText>Boolean</Select.ItemText>
                        <Select.ItemIndicator className={styles.selectItemIndicator}>
                          <Check size={16} />
                        </Select.ItemIndicator>
                      </Select.Item>
                      <Select.Item value="string" className={styles.selectItem}>
                        <Select.ItemText>String</Select.ItemText>
                        <Select.ItemIndicator className={styles.selectItemIndicator}>
                          <Check size={16} />
                        </Select.ItemIndicator>
                      </Select.Item>
                      <Select.Item value="action" className={styles.selectItem}>
                        <Select.ItemText>Action</Select.ItemText>
                        <Select.ItemIndicator className={styles.selectItemIndicator}>
                          <Check size={16} />
                        </Select.ItemIndicator>
                      </Select.Item>
                    </Select.Viewport>
                  </Select.Content>
                </Select.Portal>
              </Select.Root>
            </Form.Field>
          </Form.FieldGroup>

          <Form.Field label={<Trans>Parameter Label</Trans>} htmlFor="param-label">
            <Form.Input
              id="param-label"
              type="text"
              value={param.label}
              onChange={(e) => onObjectChange('label', e.target.value)}
            />
          </Form.Field>

          {param.type === 'number' && (
            <Form.FieldGroup columns={3}>
              <Form.Field label={<Trans>Minimum Value</Trans>} htmlFor="param-min">
                <Form.Input
                  id="param-min"
                  type="number"
                  value={(param as any).min ?? ''}
                  onChange={(e) => {
                    const currentMin = (param as any).min ?? 0;
                    onObjectChange('min', parseNumberInput(e.target.value, currentMin));
                  }}
                />
              </Form.Field>

              <Form.Field label={<Trans>Maximum Value</Trans>} htmlFor="param-max">
                <Form.Input
                  id="param-max"
                  type="number"
                  value={(param as any).max ?? ''}
                  onChange={(e) => {
                    const currentMax = (param as any).max ?? 100;
                    onObjectChange('max', parseNumberInput(e.target.value, currentMax));
                  }}
                />
              </Form.Field>

              <Form.Field label={<Trans>Step</Trans>} htmlFor="param-step">
                <Form.Input
                  id="param-step"
                  type="number"
                  value={(param as any).step ?? ''}
                  onChange={(e) => {
                    const currentStep = (param as any).step ?? 1;
                    onObjectChange('step', parseNumberInput(e.target.value, currentStep));
                  }}
                />
              </Form.Field>
            </Form.FieldGroup>
          )}

          <Form.FieldSet>
            <Form.Label htmlFor="param-runtime-change" className={styles.checkboxLabel}>
              <input
                id="param-runtime-change"
                type="checkbox"
                checked={param.allowRuntimeChange || false}
                onChange={(e) => onObjectChange('allowRuntimeChange', e.target.checked)}
                className={styles.checkboxInput}
              />
              <Trans>Allow Runtime Change</Trans>
            </Form.Label>
          </Form.FieldSet>
        </>
      )}
    </>
  );
};
