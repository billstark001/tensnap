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
  const continuous = action?.continuous ?? view.data.continuous ?? false;

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
          onChange={(e) => {
            onChange('data.continuous', e.target.checked);
            if (action) {
              onObjectChange('continuous', e.target.checked);
            }
          }}
        />
      </Form.Field>

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

          <Form.FieldSet>
            <Form.Label htmlFor="action-runtime-change" className={styles.checkboxLabel}>
              <input
                id="action-runtime-change"
                type="checkbox"
                checked={action.allowRuntimeChange || false}
                onChange={(e) => onObjectChange('allowRuntimeChange', e.target.checked)}
                className={styles.checkboxInput}
              />
              <Trans>Allow Runtime Change</Trans>
            </Form.Label>
          </Form.FieldSet>
        </div>
      ) : (
        <div className={styles.infoText}>
          <Trans>The button can keep this binding, but there is no registered action to edit.</Trans>
        </div>
      )}
    </>
  );
};
