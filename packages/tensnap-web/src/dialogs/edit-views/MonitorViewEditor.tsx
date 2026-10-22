import { Trans } from '@lingui/react/macro';
import Form from '@tensnap/web-common/components/ui/Form';
import type { AnchoredView } from '@tensnap/core/persistence';
import type { BaseViewEditorProps } from './BaseViewEditor';
import * as styles from './EditViews.css';

interface MonitorViewEditorProps extends BaseViewEditorProps {
  view: AnchoredView;
}

/** Monitor data is simulator-owned; this editor changes only local view settings. */
export function MonitorViewEditor({ view, onChange }: MonitorViewEditorProps) {
  return (
    <>
      <Form.Field label={<Trans>Title</Trans>} htmlFor="monitor-title">
        <Form.Input
          id="monitor-title"
          type="text"
          value={view.data.title ?? ''}
          onChange={(event) => onChange('data.title', event.target.value)}
        />
      </Form.Field>
      <Form.Field label={<Trans>Display</Trans>} htmlFor="monitor-render-hint">
        <Form.Select
          id="monitor-render-hint"
          value={view.data.renderHint ?? ''}
          onChange={(event) => onChange('data.renderHint', event.target.value || undefined)}
        >
          <option value="">
            <Trans>Follow simulator</Trans>
          </option>
          <option value="auto">
            <Trans>Automatic</Trans>
          </option>
          <option value="tree">
            <Trans>Tree</Trans>
          </option>
          <option value="table">
            <Trans>Table</Trans>
          </option>
          <option value="text">
            <Trans>Text</Trans>
          </option>
        </Form.Select>
        <p className={styles.infoText}>
          <Trans>
            This display preference is local to the view and does not modify the simulator monitor.
          </Trans>
        </p>
      </Form.Field>
    </>
  );
}
