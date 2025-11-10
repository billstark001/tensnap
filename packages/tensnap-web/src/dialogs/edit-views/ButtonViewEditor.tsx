import React from 'react';
import { Trans } from '@lingui/react/macro';
import Form from '@/components/ui/Form';
import { ButtonView } from '@/types/ui';
import { BaseViewFields, BaseViewEditorProps } from './BaseViewEditor';

interface ButtonViewEditorProps extends BaseViewEditorProps {
  view: ButtonView;
}

export const ButtonViewEditor: React.FC<ButtonViewEditorProps> = ({ view, onChange }) => {
  return (
    <>
      <BaseViewFields view={view} onChange={onChange} />

      <Form.Field label={<Trans>Button Text</Trans>} htmlFor="button-text">
        <Form.Input
          id="button-text"
          type="text"
          value={view.data.text}
          onChange={(e) => onChange('data.text', e.target.value)}
        />
      </Form.Field>

    </>
  );
};
