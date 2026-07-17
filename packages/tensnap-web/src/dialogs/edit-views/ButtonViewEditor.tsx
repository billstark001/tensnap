import React from 'react';
import { Trans } from '@lingui/react/macro';
import Form from '@tensnap/web-common/components/ui/Form';
import { ButtonView } from '@/types/ui';
import { BaseViewFields, BaseViewEditorProps } from './BaseViewEditor';
import { Action } from '@/types/model';
import { ObjectIdentityField } from './ObjectIdentityField';
import * as styles from './EditViews.css';

interface ButtonViewEditorProps extends BaseViewEditorProps {
  view: ButtonView;
  objectData: Action | null;
  onObjectChange: (field: string, value: any) => void;
  onEditObjectId: () => void;
}

export const ButtonViewEditor: React.FC<ButtonViewEditorProps> = ({
  view,
  objectData: action,
  onChange,
  onObjectChange,
  onEditObjectId,
}) => {
  // A view controls renderer scheduling. Action.continuous only describes
  // what the simulator accepts; it must not be changed by editing a view.
  const continuous = view.data.continuous ?? false;
  const actionContinuous = action?.continuous ?? false;

  return (
    <>
      <BaseViewFields view={view} onChange={onChange} />

      <ObjectIdentityField
        label={<Trans>Action ID</Trans>}
        value={action?.id ?? view.data.id ?? ''}
        objectExists={Boolean(action)}
        onEdit={onEditObjectId}
      />

      <Form.Field label={<Trans>Button Text</Trans>} htmlFor="button-text">
        <Form.Input
          id="button-text"
          type="text"
          value={view.data.text}
          onChange={(e) => onChange('data.text', e.target.value)}
        />
      </Form.Field>

      <Form.Field label={<Trans>Continuous</Trans>} htmlFor="button-continuous">
        <Form.Input
          id="button-continuous"
          type="checkbox"
          checked={continuous}
          onChange={(e) => onChange('data.continuous', e.target.checked)}
        />
      </Form.Field>

      {action && continuous !== actionContinuous && (
        <div className={styles.warningText}>
          <Trans>This button’s continuous setting controls renderer scheduling and differs from the simulator action declaration. It is allowed, but verify the action is safe to repeat.</Trans>
        </div>
      )}

      {action ? (
        <div className={styles.objectPanel}>
          <h3 className={styles.panelTitle}><Trans>Action</Trans></h3>

          <Form.Field label={<Trans>Action Label</Trans>} htmlFor="action-label">
            <Form.Input
              id="action-label"
              type="text"
              value={action.label}
              onChange={(e) => onObjectChange('label', e.target.value)}
            />
          </Form.Field>
        </div>
      ) : (
        <div className={styles.infoText}>
          <Trans>The button can keep this binding, but there is no registered action to edit.</Trans>
        </div>
      )}
    </>
  );
};
