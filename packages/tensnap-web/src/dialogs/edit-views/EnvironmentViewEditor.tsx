import React from 'react';
import { Trans } from '@lingui/react/macro';
import Form from '@/components/ui/Form';
import { AnchoredView } from '@/types/ui';
import { BaseViewFields, BaseViewEditorProps } from './BaseViewEditor';
import { useScenarioStore } from '@/store/scenario/store';
import { PureGridEnvironment } from '@/types/model';

interface EnvironmentViewEditorProps extends BaseViewEditorProps {
  view: AnchoredView;
}

export const EnvironmentViewEditor: React.FC<EnvironmentViewEditorProps> = ({ view, onChange }) => {
  const environments = useScenarioStore((store) => store.environments);
  const updateEnvironment = useScenarioStore((store) => store.updateEnvironment);
  
  const env = environments?.get(view.data.id);

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
          <Form.Field label={<Trans>Environment ID</Trans>} htmlFor="env-id">
            <Form.Input
              id="env-id"
              type="text"
              value={env.id}
              disabled
              style={{ opacity: 0.6, cursor: 'not-allowed' }}
            />
          </Form.Field>

          <Form.Field label={<Trans>Environment Type</Trans>} htmlFor="env-type">
            <Form.Input
              id="env-type"
              type="text"
              value={env.type}
              disabled
              style={{ opacity: 0.6, cursor: 'not-allowed' }}
            />
          </Form.Field>

          <Form.Field label={<Trans>Environment Label</Trans>} htmlFor="env-label">
            <Form.Input
              id="env-label"
              type="text"
              value={env.label || ''}
              onChange={(e) => {
                if (updateEnvironment) {
                  const newEnv = { ...env, label: e.target.value };
                  updateEnvironment(env.id, newEnv.props);
                }
              }}
            />
          </Form.Field>

          {env.type === 'grid' && (
            <>
              <Form.Field label={<Trans>Grid Width</Trans>} htmlFor="grid-width">
                <Form.Input
                  id="grid-width"
                  type="number"
                  min="1"
                  value={(env.props as PureGridEnvironment).width}
                  onChange={(e) => {
                    if (updateEnvironment) {
                      updateEnvironment(env.id, {
                        ...env.props,
                        width: parseInt(e.target.value) || 1
                      });
                    }
                  }}
                />
              </Form.Field>

              <Form.Field label={<Trans>Grid Height</Trans>} htmlFor="grid-height">
                <Form.Input
                  id="grid-height"
                  type="number"
                  min="1"
                  value={(env.props as PureGridEnvironment).height}
                  onChange={(e) => {
                    if (updateEnvironment) {
                      updateEnvironment(env.id, {
                        ...env.props,
                        height: parseInt(e.target.value) || 1
                      });
                    }
                  }}
                />
              </Form.Field>
            </>
          )}
        </>
      )}
    </>
  );
};
