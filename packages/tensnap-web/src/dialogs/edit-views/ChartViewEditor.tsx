import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { useId } from 'react';
import { Trans } from '@lingui/react/macro';
import Form from '@tensnap/web-common/components/ui/Form';
import { Button } from '@tensnap/web-common/components/ui/Dialog';
import type { AnchoredView } from '@tensnap/core/persistence';
import type { ChartGroup } from '@/types/model';
import * as styles from './EditViews.css';

export function ChartViewEditor({
  view,
  chart,
  onChange,
}: {
  view: AnchoredView;
  chart: ChartGroup | undefined;
  onChange: (field: string, value: unknown) => void;
}) {
  const fieldId = useId();
  const { _ } = useLingui();
  const series =
    view.data.chartSeries ??
    (chart
      ? Object.values(chart.metadataDict).map(({ id, label, color }) => ({
          id,
          label,
          ...(color ? { color } : {}),
        }))
      : []);
  const update = (index: number, values: Partial<(typeof series)[number]>) =>
    onChange(
      'data.chartSeries',
      series.map((item, itemIndex) => (itemIndex === index ? { ...item, ...values } : item)),
    );
  return (
    <>
      <Form.Field label={<Trans>Title</Trans>} htmlFor={`${fieldId}-title`}>
        <Form.Input
          id={`${fieldId}-title`}
          value={view.data.title ?? ''}
          onChange={(event) => onChange('data.title', event.target.value)}
        />
      </Form.Field>
      <p className={styles.infoText}>
        <Trans>
          Series settings are local to this view. Removing a series does not delete recorded data.
        </Trans>
      </p>
      {series.map((item, index) => (
        <fieldset key={index} className={styles.section}>
          <legend className={styles.sectionTitle}>{item.label || item.id}</legend>
          <div className={styles.fields}>
            <Form.Field label={<Trans>Series ID</Trans>} htmlFor={`${fieldId}-${index}-id`}>
              <Form.Input
                id={`${fieldId}-${index}-id`}
                value={item.id}
                disabled={Boolean(chart?.metadataDict[item.id])}
                onChange={(event) => update(index, { id: event.target.value })}
              />
            </Form.Field>
            <Form.Field label={<Trans>Label</Trans>} htmlFor={`${fieldId}-${index}-label`}>
              <Form.Input
                id={`${fieldId}-${index}-label`}
                value={item.label}
                onChange={(event) => update(index, { label: event.target.value })}
              />
            </Form.Field>
            <Form.Field label={<Trans>Color</Trans>} htmlFor={`${fieldId}-${index}-color`}>
              <Form.ColorInput
                id={`${fieldId}-${index}-color`}
                pickerLabel={`${_(msg`Choose color`)}: ${item.label || item.id}`}
                value={item.color ?? '#0066cc'}
                onChange={(event) => update(index, { color: event.target.value })}
              />
            </Form.Field>
          </div>
          <Button
            variant="danger"
            type="button"
            onClick={() =>
              onChange(
                'data.chartSeries',
                series.filter((_, itemIndex) => itemIndex !== index),
              )
            }
          >
            <Trans>Remove from view</Trans>
          </Button>
        </fieldset>
      ))}
      <div className={styles.actions}>
        <Button
          type="button"
          onClick={() =>
            onChange('data.chartSeries', [
              ...series,
              { id: `local-${crypto.randomUUID()}`, label: _(msg`Local series`) },
            ])
          }
        >
          <Trans>Add local series</Trans>
        </Button>
        {view.data.chartSeries && (
          <Button onClick={() => onChange('data.chartSeries', undefined)}>
            <Trans>Follow simulator</Trans>
          </Button>
        )}
      </div>
      <small>
        <Trans>
          A local series has no data until a matching source publishes it. This does not create a
          simulator series.
        </Trans>
      </small>
    </>
  );
}
