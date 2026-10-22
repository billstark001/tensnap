import { useId } from 'react';
import { Trans } from '@lingui/react/macro';
import Form from '@tensnap/web-common/components/ui/Form';
import { Switch } from '@tensnap/web-common/components/ui/Switch';
import type { ButtonView } from '@tensnap/core/persistence';
import type { Action } from '@/types/model';

export function ButtonViewEditor({
  view,
  action,
  onChange,
}: {
  view: ButtonView;
  action: Action | null;
  onChange: (field: string, value: unknown) => void;
}) {
  const fieldId = useId();
  return (
    <>
      <Form.Field label={<Trans>Button Text</Trans>} htmlFor={`${fieldId}-text`}>
        <Form.Input
          id={`${fieldId}-text`}
          value={view.data.text}
          onChange={(event) => onChange('data.text', event.target.value)}
        />
      </Form.Field>
      <Switch
        label={<Trans>Continuous scheduling</Trans>}
        checked={view.data.continuous ?? false}
        onCheckedChange={(value) => onChange('data.continuous', value)}
      />
      {action && (
        <p>
          <Trans>Simulator declaration</Trans>: {action.label} · continuous:{' '}
          {String(action.continuous ?? false)}
        </p>
      )}
    </>
  );
}
