import * as Dialog from '@/components/ui/Dialog';
import { Agent, GridAgent, GraphAgent, AgentIcon } from '@/types/model';
import * as styles from './AgentDetailsDialog.css';
import clsx from 'clsx';
import { Trans } from '@lingui/react/macro';

// Union type for all agent types
export type AnyAgent = GridAgent | GraphAgent | Agent;

interface AgentDetailsDialogProps {
  agent: AnyAgent | null;
  agentType?: 'grid' | 'graph' | 'uniform';
  onClose: () => void;
  open?: boolean;
}

// Helper function to create icon elements
export const createIconElement = (
  icon: AgentIcon | undefined | null,
  size: number,
  color: string
) => {
  const commonStyle = {
    width: `${size}px`,
    height: `${size}px`,
    color,
  };

  switch (icon) {
    case 'arrow':
      return (
        <div className={clsx(styles.iconWrapper, styles.iconArrow)} style={commonStyle}>
          ▲
        </div>
      );
    case 'square':
      return (
        <div className={clsx(styles.iconWrapper, styles.iconSquare)} style={commonStyle}>
          ■
        </div>
      );
    case 'triangle':
      return (
        <div
          className={clsx(styles.iconWrapper, styles.iconTriangle)}
          style={{
            width: 0,
            height: 0,
            backgroundColor: 'transparent',
            borderLeft: `${size / 2}px solid transparent`,
            borderRight: `${size / 2}px solid transparent`,
            borderBottom: `${size}px solid ${color}`,
          }}
        />
      );
    default: // circle
      return (
        <div className={clsx(styles.iconWrapper, styles.iconCircle)} style={commonStyle}>
          ●
        </div>
      );
  }
};

// Component to render position information
const PositionInfo = ({ agent: _agent, agentType }: Pick<AgentDetailsDialogProps, 'agent' | 'agentType'>) => {
  if (agentType === 'grid') {
    const agent = _agent as GridAgent;
    return (
      <div className={styles.positionInfo}>
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}><Trans>Position:</Trans></span>
          ({agent.x?.toFixed(4)}, {agent.y?.toFixed(4)})
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

  if (agentType === 'graph') {
    const agent = _agent as GraphAgent;
    return (
      <div className={styles.detailRow}>
        <span className={styles.detailLabel}><Trans>Position:</Trans></span>
        {agent.x !== undefined && agent.y !== undefined
          ? `(${agent.x.toFixed(2)}, ${agent.y.toFixed(2)})`
          : <Trans>Not positioned</Trans>
        }
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
  } = props;

  const isOpen = open ?? !!agent;

  if (!agent) return null;

  const size = agent.size || 16;
  const color = agent.color || '#666666';

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
            {createIconElement(agent.icon, size, color)}
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