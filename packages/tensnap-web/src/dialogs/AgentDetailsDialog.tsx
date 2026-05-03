import * as Dialog from '@tensnap/web-common/components/ui/Dialog';
import * as styles from './AgentDetailsDialog.css';
import { Trans } from '@lingui/react/macro';
import type { AgentRenderState } from '@tensnap/core/environment';
import { createIconElement } from './AgentIconElement';

// Union type for all agent types

interface AgentDetailsDialogProps {
  agent: AgentRenderState | null;
  agentType?: '2d' | 'uniform';
  onClose: () => void;
  open?: boolean;
  resolveAssetUrl?: (assetId: string) => string | undefined;
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
  } = props;

  const isOpen = open ?? !!agent;

  if (!agent) return null;

  const size = agent.size || 16;
  const color = agent.color || '#666666';
  const assetId = agent.icon?.startsWith('asset:') ? agent.icon.slice('asset:'.length) : null;
  const assetUrl = assetId ? resolveAssetUrl?.(assetId) : undefined;

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Title>
        <Trans>Agent Details</Trans>
      </Dialog.Title>
      <Dialog.Description>
        <Trans>View detailed information about the selected agent</Trans>
      </Dialog.Description>

      <div>
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}><Trans>ID:</Trans></span>
          {agent.id}
        </div>

        <PositionInfo agent={agent} agentType={agentType} />

        <div className={styles.detailRow}>
          <span className={styles.detailLabel}><Trans>Icon:</Trans></span>
          <div className={styles.agentIcon}>
            {createIconElement(agent.icon, size, color, assetUrl)}
          </div>
          {agent.icon || 'circle'}
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
          {agent.size || <Trans>default</Trans>}
        </div>

        <div className={styles.dataSection}>
          <h4 className={styles.dataSectionTitle}><Trans>Custom Data:</Trans></h4>
          <pre className={styles.dataContent}>
            {JSON.stringify(agent.data, null, 2)}
          </pre>
        </div>
      </div>

      <Dialog.Footer>
        <Dialog.Close asChild>
          <Dialog.Button><Trans>Close</Trans></Dialog.Button>
        </Dialog.Close>
      </Dialog.Footer>

      <Dialog.CloseButton />
    </Dialog.Root>
  );
}