import React from 'react';
import { Trans } from '@lingui/react/macro';
import Form from '@/components/ui/Form';
import { AnchoredView } from '@/types/ui';
import { BaseViewFields, BaseViewEditorProps } from './BaseViewEditor';
import { useScenarioStore } from '@/store/scenario/store';

interface ParameterViewEditorProps extends BaseViewEditorProps {
  view: AnchoredView;
}

export const ParameterViewEditor: React.FC<ParameterViewEditorProps> = ({ view, onChange }) => {
  const parameters = useScenarioStore((store) => store.parameters);
  const updateParameterProps = useScenarioStore((store) => store.updateParameterProps);
  
  const param = parameters?.find(p => p.id === view.data.id);

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
          <Form.Field label={<Trans>Parameter ID</Trans>} htmlFor="param-id">
            <Form.Input
              id="param-id"
              type="text"
              value={param.id}
              disabled
              style={{ opacity: 0.6, cursor: 'not-allowed' }}
            />
          </Form.Field>

          <Form.Field label={<Trans>Parameter Type</Trans>} htmlFor="param-type">
            <Form.Input
              id="param-type"
              type="text"
              value={param.type}
              disabled
              style={{ opacity: 0.6, cursor: 'not-allowed' }}
            />
          </Form.Field>

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
            <>
              <Form.Field label={<Trans>Minimum Value</Trans>} htmlFor="param-min">
                <Form.Input
                  id="param-min"
                  type="number"
                  value={(param as any).min}
                  onChange={(e) => {
                    if (updateParameterProps) {
                      updateParameterProps(param.id, { min: parseFloat(e.target.value) } as any);
                    }
                  }}
                />
              </Form.Field>

              <Form.Field label={<Trans>Maximum Value</Trans>} htmlFor="param-max">
                <Form.Input
                  id="param-max"
                  type="number"
                  value={(param as any).max}
                  onChange={(e) => {
                    if (updateParameterProps) {
                      updateParameterProps(param.id, { max: parseFloat(e.target.value) } as any);
                    }
                  }}
                />
              </Form.Field>

              <Form.Field label={<Trans>Step</Trans>} htmlFor="param-step">
                <Form.Input
                  id="param-step"
                  type="number"
                  value={(param as any).step}
                  onChange={(e) => {
                    if (updateParameterProps) {
                      updateParameterProps(param.id, { step: parseFloat(e.target.value) } as any);
                    }
                  }}
                />
              </Form.Field>
            </>
          )}

          <Form.FieldSet>
            <Form.Label htmlFor="param-runtime-change">
              <input
                id="param-runtime-change"
                type="checkbox"
                checked={param.allowRuntimeChange || false}
                onChange={(e) => {
                  if (updateParameterProps) {
                    updateParameterProps(param.id, { allowRuntimeChange: e.target.checked });
                  }
                }}
                style={{ marginRight: '8px' }}
              />
              <Trans>Allow Runtime Change</Trans>
            </Form.Label>
          </Form.FieldSet>
        </>
      )}
    </>
  );
};
