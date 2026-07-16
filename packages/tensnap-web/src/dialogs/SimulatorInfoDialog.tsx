import type { Scenario } from '@tensnap/core';
import type { SimulatorInfoPayload } from '@tensnap/protocol';
import * as Dialog from '@tensnap/web-common/components/ui/Dialog';
import { ValueInspector } from '../components/value-inspector';
import * as styles from './SimulatorInfoDialog.css';
import { useEffect, useState } from 'react';
import { Trans } from '@lingui/react/macro';

export interface SimulatorInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  simulatorInfo: SimulatorInfoPayload | null;
  scenario: Scenario | null;
}

/** Immutable session identity and mutable scenario metadata in one safe view. */
export function SimulatorInfoDialog({ open, onOpenChange, simulatorInfo, scenario }: SimulatorInfoDialogProps) {
  const [metadataRevision, setMetadataRevision] = useState(0);
  useEffect(() => {
    if (!open || !scenario) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setMetadataRevision((revision) => revision + 1);
      });
    };
    scenario.addEventListener('metadata:update', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scenario.removeEventListener('metadata:update', schedule);
    };
  }, [open, scenario]);
  const info = simulatorInfo;
  void metadataRevision;
  const metadata = scenario?.metadata ?? {};
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} size="lg">
      <Dialog.CloseButton />
      <Dialog.Title><Trans>Simulator information</Trans></Dialog.Title>
      <Dialog.Description><Trans>Session identity, capabilities, and current model metadata.</Trans></Dialog.Description>
      <Dialog.Body className={styles.body}>
        {!info ? <p className={styles.empty}><Trans>Waiting for a simulator_info handshake.</Trans></p> : <>
          <section className={styles.section}>
            <h3><Trans>Model</Trans></h3>
            <dl className={styles.details}>
              <dt><Trans>ID</Trans></dt><dd>{info.model.id}</dd>
              {info.model.name && <><dt><Trans>Name</Trans></dt><dd>{info.model.name}</dd></>}
              {info.model.version && <><dt><Trans>Version</Trans></dt><dd>{info.model.version}</dd></>}
              {info.model.state_schema_version && <><dt><Trans>State schema</Trans></dt><dd>{info.model.state_schema_version}</dd></>}
              <dt><Trans>Instance</Trans></dt><dd>{info.instance_id}</dd>
              <dt><Trans>Protocol</Trans></dt><dd>{info.protocol_version}</dd>
              <dt><Trans>Binding</Trans></dt><dd>{info.binding.name} {info.binding.version}{info.binding.language ? ` (${info.binding.language})` : ''}</dd>
            </dl>
            {info.model.description && <p className={styles.description}>{info.model.description}</p>}
          </section>
          <section className={styles.section}>
            <h3><Trans>Capabilities</Trans></h3>
            {info.capabilities.length ? <ul className={styles.capabilities}>{info.capabilities.map((capability) => <li key={capability}>{capability}</li>)}</ul> : <p className={styles.empty}><Trans>This model has not declared optional capabilities.</Trans></p>}
            {info.capability_details && <ValueInspector value={info.capability_details} renderHint="tree" compact />}
          </section>
        </>}
        <section className={styles.section}>
          <h3><Trans>Scenario metadata</Trans></h3>
          <ValueInspector value={metadata} renderHint="tree" compact />
        </section>
      </Dialog.Body>
    </Dialog.Root>
  );
}
