import React from 'react';
import { Trans } from '@lingui/react/macro';
import Form from '@/components/ui/Form';
import { AnyView } from '@/types/ui';

export interface BaseViewEditorProps {
  view: AnyView;
  onChange: (field: string, value: any) => void;
}

export const BaseViewFields: React.FC<BaseViewEditorProps> = ({ view, onChange }) => {
  return (
    <>
      <Form.Field label={<Trans>ID</Trans>} htmlFor="view-id">
        <Form.Input
          id="view-id"
          type="text"
          value={view.id}
          disabled
          style={{ opacity: 0.6, cursor: 'not-allowed' }}
        />
      </Form.Field>

      <Form.Field label={<Trans>Type</Trans>} htmlFor="view-type">
        <Form.Input
          id="view-type"
          type="text"
          value={view.type}
          disabled
          style={{ opacity: 0.6, cursor: 'not-allowed' }}
        />
      </Form.Field>

      <Form.Field label={<Trans>Left</Trans>} htmlFor="view-left">
        <Form.Input
          id="view-left"
          type="number"
          value={view.left}
          onChange={(e) => onChange('left', parseFloat(e.target.value) || 0)}
        />
      </Form.Field>

      <Form.Field label={<Trans>Top</Trans>} htmlFor="view-top">
        <Form.Input
          id="view-top"
          type="number"
          value={view.top}
          onChange={(e) => onChange('top', parseFloat(e.target.value) || 0)}
        />
      </Form.Field>

      <Form.Field label={<Trans>Width</Trans>} htmlFor="view-width">
        <Form.Input
          id="view-width"
          type="number"
          value={view.width}
          onChange={(e) => onChange('width', parseFloat(e.target.value) || 0)}
        />
      </Form.Field>

      <Form.Field label={<Trans>Height</Trans>} htmlFor="view-height">
        <Form.Input
          id="view-height"
          type="number"
          value={view.height}
          onChange={(e) => onChange('height', parseFloat(e.target.value) || 0)}
        />
      </Form.Field>

      <Form.FieldSet>
        <Form.Label htmlFor="view-expanded">
          <input
            id="view-expanded"
            type="checkbox"
            checked={view.expanded}
            onChange={(e) => onChange('expanded', e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          <Trans>Expanded</Trans>
        </Form.Label>
      </Form.FieldSet>
    </>
  );
};
