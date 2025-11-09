import { useScenarioStore } from '@/store/scenario/store';
import { Trans } from '@lingui/react/macro';
import { PanelRight, PanelBottom, PanelRightClose, PanelBottomClose } from 'lucide-react';

import * as styles from './StatusBar.css';

interface StatusBarProps {
  onToggleRightPanel?: () => void;
  onToggleBottomPanel?: () => void;
  rightPanelVisible?: boolean;
  bottomPanelVisible?: boolean;
}

export function StatusBar({
  onToggleRightPanel,
  onToggleBottomPanel,
  rightPanelVisible = true,
  bottomPanelVisible = true,
}: StatusBarProps) {
  const connected = useScenarioStore((store) => store.connected);
  const currentTime = useScenarioStore((store) => store.currentTime);

  return (
    <div className={styles.statusBar}>
      <span className={connected ? styles.statusConnected : styles.statusDisconnected}>
        {connected ? <Trans>Connected</Trans> : <Trans>Disconnected</Trans>}
      </span>
      <span style={{ marginLeft: '16px' }}><Trans>Time Step:</Trans> {currentTime}</span>
      
      <div className={styles.buttonGroup}>
        {onToggleRightPanel && (
          <button
            onClick={onToggleRightPanel}
            className={styles.toggleButton}
            title={rightPanelVisible ? 'Hide Right Panel' : 'Show Right Panel'}
          >
            {rightPanelVisible ? <PanelRightClose size={16} /> : <PanelRight size={16} />}
          </button>
        )}
        {onToggleBottomPanel && (
          <button
            onClick={onToggleBottomPanel}
            className={styles.toggleButton}
            title={bottomPanelVisible ? 'Hide Bottom Panel' : 'Show Bottom Panel'}
          >
            {bottomPanelVisible ? <PanelBottomClose size={16} /> : <PanelBottom size={16} />}
          </button>
        )}
      </div>
    </div>
  )
}
