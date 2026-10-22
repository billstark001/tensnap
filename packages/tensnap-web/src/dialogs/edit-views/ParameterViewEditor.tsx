import { useId, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import Form from '@tensnap/web-common/components/ui/Form';
import { Switch } from '@tensnap/web-common/components/ui/Switch';
import type { AnchoredView } from '@tensnap/core/persistence';
import type { Parameter } from '@/types/model';

export function ParameterViewEditor({
  view,
  parameter,
  onChange,
  onValueChange,
}: {
  view: AnchoredView;
  parameter: Parameter | null;
  onChange: (field: string, value: unknown) => void;
  onValueChange: (value: Parameter['value']) => void;
}) {
  const fieldId = useId();
  const [draft, setDraft] = useState(parameter?.value);
  const change = (value: Parameter['value']) => {
    setDraft(value);
    onValueChange(value);
  };
  return (
    <>
      <Form.Field label={<Trans>Title</Trans>} htmlFor={`${fieldId}-title`}>
        <Form.Input
          id={`${fieldId}-title`}
          value={view.data.title ?? ''}
          onChange={(event) => onChange('data.title', event.target.value)}
        />
      </Form.Field>
      {parameter && (
        <>
          <p>
            <Trans>Simulator declaration</Trans>: {parameter.type} · {parameter.label}
          </p>
          <p>
            <Trans>Runtime changes allowed</Trans>:{' '}
            {String(parameter.allow_runtime_change ?? false)}
          </p>
          {parameter.type === 'number' && (
            <p>
              min: {parameter.min ?? '—'} · max: {parameter.max ?? '—'} · step:{' '}
              {parameter.step ?? '—'}
            </p>
          )}
          <Form.Field label={<Trans>Value to apply on save</Trans>} htmlFor={`${fieldId}-value`}>
            {parameter.type === 'boolean' ? (
              <Switch
                label={<Trans>Value</Trans>}
                checked={Boolean(draft)}
                onCheckedChange={change}
              />
            ) : parameter.type === 'enum' ? (
              <Form.Select
                id={`${fieldId}-value`}
                value={String(draft)}
                onChange={(event) => change(event.target.value)}
              >
                {parameter.options?.map((option) => (
                  <option key={option} value={option}>
                    {parameter.labels?.[option] ?? option}
                  </option>
                ))}
              </Form.Select>
            ) : (
              <Form.Input
                id={`${fieldId}-value`}
                type={parameter.type === 'number' ? 'number' : 'text'}
                value={String(draft ?? '')}
                min={parameter.type === 'number' ? parameter.min : undefined}
                max={parameter.type === 'number' ? parameter.max : undefined}
                step={parameter.type === 'number' ? parameter.step : undefined}
                onChange={(event) => {
                  if (parameter.type === 'number') {
                    setDraft(event.target.value);
                    onValueChange(event.target.value.trim() ? Number(event.target.value) : NaN);
                  } else change(event.target.value);
                }}
              />
            )}
          </Form.Field>
          <small>
            <Trans>
              Values are sent to the simulator. Definition and permissions are read-only.
            </Trans>
          </small>
        </>
      )}
    </>
  );
}
