import * as Dialog from '@tensnap/web-common/components/ui/Dialog';
import Form from '@tensnap/web-common/components/ui/Form';
import * as styles from './AgentDetailsDialog.css';
import { Trans } from '@lingui/react/macro';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Scenario, ScenarioInspector } from '@tensnap/core';
import type { AgentRef, LiveAgentInspection } from '@tensnap/core';
import type { AgentRenderState } from '@tensnap/core/environment';
import type { ScenarioEnvironmentState } from '@tensnap/core/scenario';
import { EnvironmentRendererController } from '@tensnap/core/scenario/browser';
import { createIconElement } from './AgentIconElement';

// Union type for all agent types

interface AgentDetailsDialogProps {
  agent: AgentRenderState | null;
  /** Stable identity used to resolve live data while the inspector is open. */
  agentRef?: AgentRef | null;
  scenario?: Scenario | null;
  agentType?: '2d' | 'uniform';
  onClose: () => void;
  open?: boolean;
  resolveAssetUrl?: (assetId: string) => string | undefined;
}

const INSPECTION_EVENTS = [
  'metadata:update', 'env:create', 'env:delete', 'layer:create', 'layer:update',
  'layer:delete', 'item:create', 'item:update', 'item:delete', 'reset',
] as const;
const INSPECTION_REFRESH_MS = 100;

function useLiveInspection(
  scenario: Scenario | null | undefined,
  agentRef: AgentRef | null | undefined,
  radius: number,
  enabled: boolean,
): LiveAgentInspection | undefined {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!enabled || !scenario || !agentRef) {
      return;
    }
    const releaseSpatialIndex = new ScenarioInspector(scenario).retainSpatialIndex(agentRef);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleUpdate = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        setRevision((current) => current + 1);
      }, INSPECTION_REFRESH_MS);
    };
    for (const event of INSPECTION_EVENTS) {
      scenario.addEventListener(event, scheduleUpdate);
    }
    return () => {
      if (timer) clearTimeout(timer);
      for (const event of INSPECTION_EVENTS) {
        scenario.removeEventListener(event, scheduleUpdate);
      }
      releaseSpatialIndex();
    };
  }, [scenario, agentRef, enabled]);

  return useMemo(() => {
    void revision;
    return enabled && scenario && agentRef
      ? new ScenarioInspector(scenario).inspectLive(agentRef, { radius })
      : undefined;
  }, [agentRef, radius, revision, scenario, enabled]);
}

function AgentInspectionCanvas({
  inspection,
  environment,
  resolveAssetUrl,
  follow,
}: {
  inspection: Exclude<LiveAgentInspection, { kind: 'none' }>;
  environment: ScenarioEnvironmentState;
  resolveAssetUrl?: (assetId: string) => string | undefined;
  follow: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<EnvironmentRendererController | null>(null);
  const resolveAssetUrlRef = useRef(resolveAssetUrl);

  useEffect(() => {
    resolveAssetUrlRef.current = resolveAssetUrl;
  }, [resolveAssetUrl]);

  const resolveCurrentAssetUrl = useCallback((assetId: string) => (
    resolveAssetUrlRef.current?.(assetId)
  ), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const controller = new EnvironmentRendererController(container, {
      resolveAssetUrl: resolveCurrentAssetUrl,
      highlightedAgent: { layerId: inspection.layerId, agentId: inspection.ref.agentId },
      // Inspector canvases must never write a second d3-force layout back to
      // their transient AgentStorage, regardless of scene semantics.
      readOnlyGraphLayout: true,
    });
    controllerRef.current = controller;
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, [inspection.kind, inspection.layerId, inspection.ref.agentId, resolveCurrentAssetUrl]);

  useEffect(() => {
    // Bind the preview to the original storages. Agent/edge/trajectory layers
    // subscribe to those storages, so model ticks update in place instead of
    // cloning a snapshot and recreating a canvas tree every refresh.
    controllerRef.current?.render(environment);
  }, [environment, inspection.ref.agentId, inspection.ref.layerId]);

  useEffect(() => {
    if (follow && inspection.viewport) {
      controllerRef.current?.setViewport(inspection.viewport);
    }
  }, [follow, inspection.viewport]);

  return <div ref={containerRef} className={styles.inspectionCanvas} aria-label="Agent neighbourhood" />;
}

// Component to render position information
const PositionInfo = ({ agent: _agent, agentType }: Pick<AgentDetailsDialogProps, 'agent' | 'agentType'>) => {
  if (agentType === '2d') {
    const agent = _agent as AgentRenderState;
    return (
      <div className={styles.positionInfo}>
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}><Trans>Position:</Trans></span>
          {agent.x !== undefined && agent.y !== undefined
            ? `(${agent.x.toFixed(4)}, ${agent.y.toFixed(4)})`
            : <Trans>Not positioned</Trans>
          }
        </div>
        {agent.heading !== undefined && (
          <div className={styles.headingInfo}>
            <span className={styles.detailLabel}><Trans>Heading:</Trans></span>
            {(agent.heading * 180 / Math.PI).toFixed(2)}°
          </div>
        )}
      </div>
    );
  }

  return null;
};

export function AgentDetailsDialog(props: AgentDetailsDialogProps) {
  const {
    agent,
    onClose,
    open,
    agentType = 'uniform',
    resolveAssetUrl,
    agentRef,
    scenario,
  } = props;

  const isOpen = open ?? !!agent;

  const [radius, setRadius] = useState(3);
  const [radiusInput, setRadiusInput] = useState('3');
  const [follow, setFollow] = useState(true);
  const inspection = useLiveInspection(scenario, agentRef, radius, isOpen);
  const liveAgent = scenario && agentRef ? inspection?.agent : agent;
  const inspectionEnvironment = inspection && inspection.kind !== 'none'
    ? scenario?.getEnvironment(inspection.environmentId)
    : undefined;

  useEffect(() => {
    if (scenario && agentRef && !inspection) {
      onClose();
    }
  }, [agentRef, inspection, onClose, scenario]);

  if (!liveAgent) return null;

  const size = liveAgent.size || 16;
  const color = liveAgent.color || '#666666';
  const assetId = liveAgent.icon?.startsWith('asset:') ? liveAgent.icon.slice('asset:'.length) : null;
  const assetUrl = assetId ? resolveAssetUrl?.(assetId) : undefined;
  const hasCustomData = liveAgent.data !== undefined && Object.keys(liveAgent.data).length > 0;

  const updateRadius = (value: string) => {
    setRadiusInput(value);
    const nextRadius = Number(value);
    if (value.trim() && Number.isFinite(nextRadius) && nextRadius >= 0.5) {
      setRadius(nextRadius);
    }
  };

  const normalizeRadius = () => {
    const nextRadius = Number(radiusInput);
    if (!radiusInput.trim() || !Number.isFinite(nextRadius) || nextRadius < 0.5) {
      setRadiusInput(String(radius));
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()} size="lg">
      <Dialog.Title>
        <Trans>Agent Details</Trans>
      </Dialog.Title>
      <Dialog.Description>
        <Trans>View detailed information about the selected agent</Trans>
      </Dialog.Description>

      <Dialog.Body className={styles.dialogBody}>
        {inspection && inspection.kind !== 'none' && inspectionEnvironment && (
          <div className={styles.inspectionSection}>
            <AgentInspectionCanvas
              inspection={inspection}
              environment={inspectionEnvironment}
              resolveAssetUrl={resolveAssetUrl}
              follow={follow}
            />
            <div className={styles.inspectionControls}>
              <Form.FieldSet className={styles.radiusField}>
                <Form.Label htmlFor="agent-inspection-radius"><Trans>Radius</Trans></Form.Label>
                <Form.Input
                  id="agent-inspection-radius"
                  aria-label="Inspection radius"
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={radiusInput}
                  onChange={(event) => updateRadius(event.target.value)}
                  onBlur={normalizeRadius}
                />
              </Form.FieldSet>
              <label className={styles.followControl}>
                <input
                  type="checkbox"
                  checked={follow}
                  onChange={(event) => setFollow(event.target.checked)}
                />
                <Trans>Follow agent</Trans>
              </label>
              <span className={styles.neighborCount}>
                <Trans>Neighbors: {inspection.neighborCount}</Trans>
              </span>
            </div>
          </div>
        )}
        {(agentType === 'uniform' || inspection?.kind === 'none') && (
          <div className={styles.noSpatialContext}>
            <Trans>No spatial context is available for this agent.</Trans>
          </div>
        )}
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}><Trans>ID:</Trans></span>
          {liveAgent.id}
        </div>

        <PositionInfo agent={liveAgent} agentType={agentType} />

        <div className={styles.detailRow}>
          <span className={styles.detailLabel}><Trans>Icon:</Trans></span>
          <div className={styles.agentIcon}>
            {createIconElement(liveAgent.icon, size, color, assetUrl)}
          </div>
          {liveAgent.icon || 'circle'}
        </div>

        <div className={styles.detailRow}>
          <span className={styles.detailLabel}><Trans>Color:</Trans></span>
          <span
            className={styles.colorSwatch}
            style={{ backgroundColor: color }}
          />
          {color}
        </div>

        <div className={styles.detailRow}>
          <span className={styles.detailLabel}><Trans>Size:</Trans></span>
          {liveAgent.size || <Trans>default</Trans>}
        </div>

        <div className={styles.dataSection}>
          <div className={styles.dataHeader}>
            <h4 className={styles.dataSectionTitle}><Trans>Custom Data:</Trans></h4>
            {!hasCustomData && <span className={styles.dataEmpty}><Trans>None</Trans></span>}
          </div>
          {hasCustomData && (
            <pre className={styles.dataContent}>
              {JSON.stringify(liveAgent.data, null, 2)}
            </pre>
          )}
        </div>
      </Dialog.Body>

      <Dialog.Footer>
        <Dialog.Close asChild>
          <Dialog.Button><Trans>Close</Trans></Dialog.Button>
        </Dialog.Close>
      </Dialog.Footer>

      <Dialog.CloseButton />
    </Dialog.Root>
  );
}
