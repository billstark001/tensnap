import React from 'react';
import { Trans } from '@lingui/react/macro';
import Form from '@/components/ui/Form';
import { ContainerView } from '@/types/ui';
import { BaseViewFields, BaseViewEditorProps } from './BaseViewEditor';

interface ContainerViewEditorProps extends BaseViewEditorProps {
  view: ContainerView;
}

export const ContainerViewEditor: React.FC<ContainerViewEditorProps> = ({ view, onChange }) => {
  return (
    <>
      <BaseViewFields view={view} onChange={onChange} />

      <Form.Field label={<Trans>Title</Trans>} htmlFor="container-title">
        <Form.Input
          id="container-title"
          type="text"
          value={view.data.title}
          onChange={(e) => onChange('data.title', e.target.value)}
        />
      </Form.Field>
    </>
  );
};
