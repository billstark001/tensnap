import { useId, useRef, useState, type ComponentProps } from 'react';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import Form from '@tensnap/web-common/components/ui/Form';
import { Button } from '@tensnap/web-common/components/ui/Dialog';
import * as styles from './EditViews.css';
import { Switch } from '@tensnap/web-common/components/ui/Switch';
import type { AnchoredView } from '@tensnap/core/persistence';
import {
  layerPresentationFields,
  layerPresentationMetadata,
  type ScenarioEnvironmentState,
} from '@tensnap/core/scenario';
import type { ProtocolData } from '@tensnap/protocol';

function PresentationNumberInput({
  value,
  onValueChange,
  ...props
}: Omit<ComponentProps<typeof Form.Input>, 'value' | 'onChange'> & {
  value: number;
  onValueChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Form.Input
      {...props}
      type="number"
      value={draft ?? (Number.isFinite(value) ? String(value) : '')}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        onValueChange(raw.trim() ? Number(raw) : NaN);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

export function EnvironmentViewEditor({
  view,
  environment,
  onChange,
}: {
  view: AnchoredView;
  environment: ScenarioEnvironmentState | undefined;
  onChange: (field: string, value: unknown) => void;
}) {
  const fieldId = useId();
  const { _ } = useLingui();
  const distances = useRef(new Map<string, number>());
  const update = (layerId: string, field: string, value: ProtocolData | undefined) => {
    const overrides = structuredClone(view.data.layerOverrides ?? {});
    const values = { ...overrides[layerId] };
    if (value === undefined) delete values[field];
    else values[field] = value;
    if (Object.keys(values).length)
      Object.defineProperty(overrides, layerId, {
        value: values,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    else delete overrides[layerId];
    onChange('data.layerOverrides', overrides);
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
      {view.data.layerOverrides && (
        <Button
          className={styles.actions}
          onClick={() => onChange('data.layerOverrides', undefined)}
        >
          <Trans>Reset all layer preferences</Trans>
        </Button>
      )}
      {environment && (
        <>
          <p className={styles.infoText}>
            <Trans>Declared environment type</Trans>: {environment.type}
          </p>
          <Form.Field label={<Trans>Display</Trans>} htmlFor={`${fieldId}-display`}>
            <Form.Select
              id={`${fieldId}-display`}
              value={view.data.type ?? ''}
              onChange={(event) => onChange('data.type', event.target.value || undefined)}
            >
              <option value="">
                <Trans>Follow simulator</Trans>
              </option>
              <option value="2d">2D</option>
              <option value="uniform">Uniform</option>
            </Form.Select>
          </Form.Field>
          {[...environment.layers.values()].map((layer) => (
            <details key={layer.id} className={styles.section} open>
              <summary className={styles.sectionSummary}>
                {layer.id} ({layer.layerType})
              </summary>
              <div className={styles.sectionContent}>
                <p className={styles.infoText}>
                  <Trans>Dependencies</Trans>: {JSON.stringify(layer.dependencyLayerIds)}
                </p>
                <div className={styles.fields}>
                  {Object.entries(layerPresentationFields(layer.layerType)).map(
                    ([field, definition]) => {
                      const override = view.data.layerOverrides?.[layer.id]?.[field];
                      const published = layerPresentationMetadata(layer)[field];
                      const value = override ?? published ?? definition.defaultValue;
                      return (
                        <div key={field} className={styles.fieldRow}>
                          {field === 'link_distance' && (
                            <Switch
                              label={<Trans>Force-directed layout</Trans>}
                              checked={Number(value) >= 0}
                              onCheckedChange={(enabled) => {
                                if (!enabled && Number(value) >= 0)
                                  distances.current.set(layer.id, Number(value));
                                update(
                                  layer.id,
                                  field,
                                  enabled
                                    ? (distances.current.get(layer.id) ??
                                        (typeof published === 'number' && published >= 0
                                          ? published
                                          : 4))
                                    : -1,
                                );
                              }}
                            />
                          )}
                          <Form.Field
                            htmlFor={`${fieldId}-${layer.id}-${field}`}
                            label={
                              <>
                                {field}{' '}
                                <span className={styles.fieldSource}>
                                  {override === undefined ? (
                                    <Trans>Inherited</Trans>
                                  ) : (
                                    <Trans>Local</Trans>
                                  )}
                                </span>
                              </>
                            }
                          >
                            {definition.choices ? (
                              <Form.Select
                                id={`${fieldId}-${layer.id}-${field}`}
                                value={String(value)}
                                onChange={(event) => update(layer.id, field, event.target.value)}
                              >
                                {definition.choices.map((choice) => (
                                  <option key={choice} value={choice}>
                                    {choice}
                                  </option>
                                ))}
                              </Form.Select>
                            ) : typeof definition.defaultValue === 'number' ? (
                              <PresentationNumberInput
                                id={`${fieldId}-${layer.id}-${field}`}
                                step="any"
                                min={definition.min}
                                value={Number(value)}
                                onValueChange={(next) => update(layer.id, field, next)}
                              />
                            ) : definition.color ? (
                              <Form.ColorInput
                                id={`${fieldId}-${layer.id}-${field}`}
                                pickerLabel={`${_(msg`Choose color`)}: ${layer.id}.${field}`}
                                value={String(value)}
                                onChange={(event) => update(layer.id, field, event.target.value)}
                              />
                            ) : (
                              <Form.Input
                                id={`${fieldId}-${layer.id}-${field}`}
                                value={String(value)}
                                onChange={(event) => update(layer.id, field, event.target.value)}
                              />
                            )}
                          </Form.Field>
                          {override !== undefined && (
                            <Button
                              className={styles.inheritButton}
                              onClick={() => update(layer.id, field, undefined)}
                            >
                              <Trans>Follow simulator</Trans>
                            </Button>
                          )}
                        </div>
                      );
                    },
                  )}
                </div>
                <details>
                  <summary>
                    <Trans>Read-only declaration</Trans>
                  </summary>
                  <pre className={styles.declaration}>
                    {JSON.stringify(layer.metadata, null, 2)}
                  </pre>
                </details>
              </div>
            </details>
          ))}
        </>
      )}
    </>
  );
}
