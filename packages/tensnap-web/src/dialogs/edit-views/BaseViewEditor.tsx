import React from 'react';
import { Trans } from '@lingui/react/macro';
import Form from '@/components/ui/Form';
import { AnyView } from '@/types/ui';
import * as styles from './EditViews.css';

export interface BaseViewEditorProps {
  view: AnyView;
  onChange: (field: string, value: any) => void;
}

// Helper function to parse number input safely
const parseNumberInput = (value: string, fallback: number = 0): number => {
  if (value === '' || value === '-') {
    return fallback;
  }
  const parsed = parseFloat(value);
  return isNaN(parsed) ? fallback : parsed;
};

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
            onChange={(e) => onChange('left', parseNumberInput(e.target.value, view.left))}
          />
        </Form.Field>

        <Form.Field label={<Trans>Top</Trans>} htmlFor="view-top">
          <Form.Input
            id="view-top"
            type="number"
            value={view.top}
            onChange={(e) => onChange('top', parseNumberInput(e.target.value, view.top))}
          />
        </Form.Field>

        <Form.Field label={<Trans>Width</Trans>} htmlFor="view-width">
          <Form.Input
            id="view-width"
            type="number"
            value={view.width}
            onChange={(e) => onChange('width', parseNumberInput(e.target.value, view.width))}
          />
        </Form.Field>

        <Form.Field label={<Trans>Height</Trans>} htmlFor="view-height">
          <Form.Input
            id="view-height"
            type="number"
            value={view.height}
            onChange={(e) => onChange('height', parseNumberInput(e.target.value, view.height))}
          />
        </Form.Field>
      </Form.FieldGroup>

      {view.type === 'container' && <Form.FieldSet>
        <Form.Label htmlFor="view-expanded" className={styles.checkboxLabel}>
          <input
            id="view-expanded"
            type="checkbox"
            checked={view.expanded}
            onChange={(e) => onChange('expanded', e.target.checked)}
            className={styles.checkboxInput}
          />
          <Trans>Expanded</Trans>
        </Form.Label>
      </Form.FieldSet>}
    </>
  );
};
