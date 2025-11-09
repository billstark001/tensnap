import React, { useMemo } from 'react';
import { Trans } from '@lingui/react/macro';
import Form from '@/components/ui/Form';
import { AnchoredView } from '@/types/ui';
import { BaseViewFields, BaseViewEditorProps } from './BaseViewEditor';
import { useScenarioStore } from '@/store/scenario/store';
import * as styles from './EditViews.css';

interface ParameterViewEditorProps extends BaseViewEditorProps {
  view: AnchoredView;
}

// Helper function to parse number input safely
const parseNumberInput = (value: string, fallback: number = 0): number => {
  if (value === '' || value === '-') {
    return fallback;
  }
  const parsed = parseFloat(value);
  return isNaN(parsed) ? fallback : parsed;
};

export const ParameterViewEditor: React.FC<ParameterViewEditorProps> = ({ view, onChange }) => {
  const parameters = useScenarioStore((store) => store.parameters);
  const param = useMemo(() => {
    return parameters?.find(p => p.id === view.data?.id)
  }, [parameters, view.data?.id]);
  
  const updateParameterProps = useScenarioStore((store) => store.updateParameterProps);
  

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
                disabled
                className={styles.disabledField}
              />
            </Form.Field>

            <Form.Field label={<Trans>Parameter Type</Trans>} htmlFor="param-type">
              <Form.Input
                id="param-type"
                type="text"
                value={param.type}
                disabled
                className={styles.disabledField}
              />
            </Form.Field>
          </Form.FieldGroup>

          <Form.Field label={<Trans>Parameter Label</Trans>} htmlFor="param-label">
            <Form.Input
              id="param-label"
              type="text"
              value={param.label}
              onChange={(e) => {
                if (updateParameterProps) {
                  updateParameterProps(param.id, { label: e.target.value });
                }
              }}
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
                    if (updateParameterProps) {
                      const currentMin = (param as any).min ?? 0;
                      updateParameterProps(param.id, { 
                        min: parseNumberInput(e.target.value, currentMin) 
                      } as any);
                    }
                  }}
                />
              </Form.Field>

              <Form.Field label={<Trans>Maximum Value</Trans>} htmlFor="param-max">
                <Form.Input
                  id="param-max"
                  type="number"
                  value={(param as any).max ?? ''}
                  onChange={(e) => {
                    if (updateParameterProps) {
                      const currentMax = (param as any).max ?? 100;
                      updateParameterProps(param.id, { 
                        max: parseNumberInput(e.target.value, currentMax) 
                      } as any);
                    }
                  }}
                />
              </Form.Field>

              <Form.Field label={<Trans>Step</Trans>} htmlFor="param-step">
                <Form.Input
                  id="param-step"
                  type="number"
                  value={(param as any).step ?? ''}
                  onChange={(e) => {
                    if (updateParameterProps) {
                      const currentStep = (param as any).step ?? 1;
                      updateParameterProps(param.id, { 
                        step: parseNumberInput(e.target.value, currentStep) 
                      } as any);
                    }
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
                onChange={(e) => {
                  if (updateParameterProps) {
                    updateParameterProps(param.id, { allowRuntimeChange: e.target.checked });
                  }
                }}
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
