import { Trans } from '@lingui/react/macro';
import Form from '@tensnap/web-common/components/ui/Form';
import type { MonitorState } from '@tensnap/core/monitor';
import type { AnchoredView } from '@/types/ui';
import { useScenarioStore } from '@/store/scenario/store';
import { BaseViewFields, type BaseViewEditorProps } from './BaseViewEditor';
import * as styles from './EditViews.css';

interface MonitorViewEditorProps extends BaseViewEditorProps {
  view: AnchoredView;
}

/** Monitor data is simulator-owned; this editor changes only local view settings. */
export function MonitorViewEditor({ view, onChange }: MonitorViewEditorProps) {
  const scenario = useScenarioStore((store) => store.scenario);
  const monitorRevision = useScenarioStore((store) => store.monitorRevision);
  void monitorRevision;
  const available = scenario ? [...scenario.monitors.all.values()].sort((left, right) => (
    left.label.localeCompare(right.label) || left.id.localeCompare(right.id)
  )) : [];
  const selected = scenario?.monitors.get(view.data.id);

  const bind = (monitor: MonitorState | undefined) => {
    if (!monitor) return;
    onChange('data.id', monitor.id);
    if (!view.data.title || view.data.title === selected?.label) onChange('data.title', monitor.label);
    if (view.data.renderHint === undefined) onChange('data.renderHint', monitor.render_hint ?? 'auto');
  };

  return (
    <>
      <BaseViewFields view={view} onChange={onChange} />
      <Form.Field label={<Trans>Monitor</Trans>} htmlFor="monitor-id">
        <Form.Select id="monitor-id" value={view.data.id} onChange={(event) => bind(scenario?.monitors.get(event.target.value))} disabled={available.length === 0}>
          {!selected && <option value={view.data.id}>{view.data.id}</option>}
          {available.map((monitor) => <option key={monitor.id} value={monitor.id}>{monitor.label || monitor.id} ({monitor.id})</option>)}
        </Form.Select>
        {available.length === 0 && <p className={styles.infoText}><Trans>No monitors are currently published by the simulator.</Trans></p>}
      </Form.Field>
      <Form.Field label={<Trans>Title</Trans>} htmlFor="monitor-title">
        <Form.Input id="monitor-title" type="text" value={view.data.title ?? ''} onChange={(event) => onChange('data.title', event.target.value)} />
      </Form.Field>
      <Form.Field label={<Trans>Display</Trans>} htmlFor="monitor-render-hint">
        <Form.Select id="monitor-render-hint" value={view.data.renderHint ?? selected?.render_hint ?? 'auto'} onChange={(event) => onChange('data.renderHint', event.target.value)}>
          <option value="auto"><Trans>Automatic</Trans></option>
          <option value="tree"><Trans>Tree</Trans></option>
          <option value="table"><Trans>Table</Trans></option>
          <option value="text"><Trans>Text</Trans></option>
        </Form.Select>
        <p className={styles.infoText}><Trans>This display preference is local to the view and does not modify the simulator monitor.</Trans></p>
      </Form.Field>
    </>
  );
}
