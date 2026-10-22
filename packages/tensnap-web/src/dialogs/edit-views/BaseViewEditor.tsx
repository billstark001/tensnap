import { Switch } from '@tensnap/web-common/components/ui/Switch';
import React from 'react';
import { Trans } from '@lingui/react/macro';
import Form from '@tensnap/web-common/components/ui/Form';
import type { AnyView } from '@tensnap/core/persistence';
import * as styles from './EditViews.css';
import { parseFiniteNumberInput } from './form-values';

export interface BaseViewEditorProps {
  view: AnyView;
  onChange: (field: string, value: any) => void;
}

export const BaseViewFields: React.FC<BaseViewEditorProps> = ({ view, onChange }) => {
  return (
    <>
      <Form.FieldGroup columns={2}>
        <Form.Field label={<Trans>ID</Trans>} htmlFor="view-id">
          <Form.Input
            id="view-id"
            type="text"
            value={view.id}
            disabled
            className={styles.disabledField}
          />
        </Form.Field>

        <Form.Field label={<Trans>Type</Trans>} htmlFor="view-type">
          <Form.Input
            id="view-type"
            type="text"
            value={view.type}
            disabled
            className={styles.disabledField}
          />
        </Form.Field>
      </Form.FieldGroup>

      <Form.FieldGroup columns={4}>
        <Form.Field label={<Trans>Left</Trans>} htmlFor="view-left">
          <Form.Input
            id="view-left"
            type="number"
            value={view.left}
            onChange={(e) => onChange('left', parseFiniteNumberInput(e.target.value, view.left))}
          />
        </Form.Field>

        <Form.Field label={<Trans>Top</Trans>} htmlFor="view-top">
          <Form.Input
            id="view-top"
            type="number"
            value={view.top}
            onChange={(e) => onChange('top', parseFiniteNumberInput(e.target.value, view.top))}
          />
        </Form.Field>

        <Form.Field label={<Trans>Width</Trans>} htmlFor="view-width">
          <Form.Input
            id="view-width"
            type="number"
            min={1}
            value={view.width}
            onChange={(e) =>
              onChange('width', Math.max(1, parseFiniteNumberInput(e.target.value, view.width)))
            }
          />
        </Form.Field>

        <Form.Field label={<Trans>Height</Trans>} htmlFor="view-height">
          <Form.Input
            id="view-height"
            type="number"
            min={1}
            value={view.height}
            onChange={(e) =>
              onChange('height', Math.max(1, parseFiniteNumberInput(e.target.value, view.height)))
            }
          />
        </Form.Field>
      </Form.FieldGroup>

      {view.type === 'container' ? (
        <Switch
          label={<Trans>Expanded</Trans>}
          checked={view.expanded}
          onCheckedChange={(value) => onChange('expanded', value)}
        />
      ) : (
        <Switch
          label={<Trans>Disabled</Trans>}
          checked={view.disabled}
          onCheckedChange={(value) => onChange('disabled', value)}
        />
      )}
    </>
  );
};
