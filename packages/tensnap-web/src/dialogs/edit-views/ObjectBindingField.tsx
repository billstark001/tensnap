import { Trans } from '@lingui/react/macro';
import { useId } from 'react';
import Form from '@tensnap/web-common/components/ui/Form';
import type { AnyView } from '@tensnap/core/persistence';
import { useScenarioStore } from '@/store/scenario/store';

export function ObjectBindingField({
  view,
  onChange,
}: {
  view: AnyView;
  onChange: (id: string) => void;
}) {
  const scenario = useScenarioStore((state) => state.scenario);
  const fieldId = useId();
  if (!scenario || view.type === 'container') return null;
  const objects =
    view.type === 'button'
      ? [...scenario.actions.values()]
      : view.type === 'parameter'
        ? [...scenario.parameters.values()]
        : view.type === 'environment'
          ? [...scenario.environments.values()]
          : view.type === 'chart'
            ? scenario.charts.getGroupList()
            : [...scenario.monitors.all.values()];
  const selectedId = view.data.id;
  return (
    <Form.Field label={<Trans>Bound object</Trans>} htmlFor={fieldId}>
      <Form.Select
        id={fieldId}
        value={selectedId}
        onChange={(event) => onChange(event.target.value)}
      >
        {!objects.some((object) => object.id === selectedId) && (
          <option value={selectedId}>
            {selectedId || '—'} (<Trans>Unavailable</Trans>)
          </option>
        )}
        {objects.map((object) => (
          <option key={object.id} value={object.id}>
            {'label' in object ? object.label : object.id} ({object.id})
          </option>
        ))}
      </Form.Select>
      <small>
        <Trans>Changes only this view's binding. Simulator object IDs are read-only.</Trans>
      </small>
    </Form.Field>
  );
}
