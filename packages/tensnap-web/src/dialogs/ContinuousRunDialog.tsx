import { useState } from 'react';
import { Trans } from '@lingui/react/macro';
import * as Dialog from '@tensnap/web-common/components/ui/Dialog';
import Form from '@tensnap/web-common/components/ui/Form';
import type { ContinuousRunProfile } from '@/store/settings';

export interface ContinuousRunDialogProps {
  open: boolean;
  actionId: string;
  profile?: ContinuousRunProfile;
  onOpenChange: (open: boolean) => void;
  onRun: (profile: ContinuousRunProfile) => void;
}

/** Configure a bounded run without bypassing the view context menu. */
export const ContinuousRunDialog = ({
  open,
  actionId,
  profile,
  onOpenChange,
  onRun,
}: ContinuousRunDialogProps) => {
  const [maxSteps, setMaxSteps] = useState(String(profile?.maxSteps ?? 1000));
  const [stopWhen, setStopWhen] = useState(profile?.stopWhen ?? '');
  const [maxWallTimeMs, setMaxWallTimeMs] = useState(profile?.maxWallTimeMs ? String(profile.maxWallTimeMs) : '');
  const [record, setRecord] = useState(profile?.record ?? false);
  const [error, setError] = useState<'max-steps' | 'wall-time' | null>(null);

  const submit = () => {
    const steps = Number(maxSteps);
    const wallTime = maxWallTimeMs.trim() ? Number(maxWallTimeMs) : undefined;
    if (!Number.isInteger(steps) || steps < 1 || steps > 1_000_000) {
      setError('max-steps');
      return;
    }
    if (wallTime !== undefined && (!Number.isFinite(wallTime) || wallTime <= 0)) {
      setError('wall-time');
      return;
    }

    onRun({
      maxSteps: steps,
      stopWhen: stopWhen.trim() || undefined,
      maxWallTimeMs: wallTime,
      record,
    });
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Title><Trans>Continuous run</Trans></Dialog.Title>
      <Dialog.Description>
        <Trans>Configure a bounded continuous run for action {actionId}.</Trans>
      </Dialog.Description>
      <Dialog.CloseButton />

      <Form.Root onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <Dialog.Body>
          <Form.FieldSet>
            <Form.Label htmlFor="continuous-run-max-steps"><Trans>Maximum steps</Trans></Form.Label>
            <Form.Input
              id="continuous-run-max-steps"
              type="number"
              min="1"
              max="1000000"
              value={maxSteps}
              onChange={(event) => setMaxSteps(event.target.value)}
            />
          </Form.FieldSet>
          <Form.FieldSet>
            <Form.Label htmlFor="continuous-run-stop-expression"><Trans>Stop expression (optional)</Trans></Form.Label>
            <Form.Input
              id="continuous-run-stop-expression"
              value={stopWhen}
              onChange={(event) => setStopWhen(event.target.value)}
              placeholder="charts.population === 0"
            />
          </Form.FieldSet>
          <Form.FieldSet>
            <Form.Label htmlFor="continuous-run-wall-time"><Trans>Wall-clock limit, ms (optional)</Trans></Form.Label>
            <Form.Input
              id="continuous-run-wall-time"
              type="number"
              min="1"
              value={maxWallTimeMs}
              onChange={(event) => setMaxWallTimeMs(event.target.value)}
            />
          </Form.FieldSet>
          <Form.FieldSet>
            <Form.Label htmlFor="continuous-run-record">
              <Form.Input
                id="continuous-run-record"
                type="checkbox"
                checked={record}
                onChange={(event) => setRecord(event.target.checked)}
                style={{ width: 'auto', marginRight: '0.5rem' }}
              />
              <Trans>Record this run</Trans>
            </Form.Label>
          </Form.FieldSet>
          {error === 'max-steps' && (
            <p role="alert"><Trans>Maximum steps must be an integer from 1 to 1,000,000.</Trans></p>
          )}
          {error === 'wall-time' && (
            <p role="alert"><Trans>Wall-clock limit must be a positive number of milliseconds.</Trans></p>
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Close asChild>
            <Dialog.Button type="button"><Trans>Cancel</Trans></Dialog.Button>
          </Dialog.Close>
          <Dialog.Button type="submit" variant="primary"><Trans>Start continuous run</Trans></Dialog.Button>
        </Dialog.Footer>
      </Form.Root>
    </Dialog.Root>
  );
};
