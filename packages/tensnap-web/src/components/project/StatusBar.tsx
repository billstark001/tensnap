import { useScenarioStore } from '@/store/scenario';
import { Trans } from '@lingui/react/macro';

import * as styles from './StatusBar.css';

export function StatusBar() {
  const connected = useScenarioStore((store) => store.connected);
  const currentTime = useScenarioStore((store) => store.currentTime);

  return (
    <div className={styles.statusBar}>
      <span className={connected ? styles.statusConnected : styles.statusDisconnected}>
        {connected ? <Trans>Connected</Trans> : <Trans>Disconnected</Trans>}
      </span>
      <span style={{ marginLeft: '16px' }}><Trans>Time Step:</Trans> {currentTime}</span>
    </div>
  )
}
