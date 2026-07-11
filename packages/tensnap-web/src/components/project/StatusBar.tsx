import { useScenarioStore } from '@/store/scenario/store';
import { useTransportStore } from '@/store/transport';
import { useToast } from '@/store/toast';
import { useSettingsStore } from '@/store/settings';
import { Trans } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { PanelRight, PanelBottom, PanelRightClose, PanelBottomClose, RefreshCw, Wrench } from 'lucide-react';
import { useState, useCallback } from 'react';

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
  const { _ } = useLingui();
  const toast = useToast();
  const connected = useScenarioStore((store) => store.connected);
  const currentTime = useScenarioStore((store) => store.currentTime);
  const runtimeTps = useSettingsStore((store) => store.runtimeTps);
  const runtimeMspt = useSettingsStore((store) => store.runtimeMspt);
  const simulatorMspt = useSettingsStore((store) => store.simulatorMspt);
  const simulatorCommMs = useSettingsStore((store) => store.simulatorCommMs);
  const simulatorRenderMs = useSettingsStore((store) => store.simulatorRenderMs);
  const setSettingsDialogOpen = useSettingsStore((store) => store.setSettingsDialogOpen);
  const transportStore = useTransportStore();
  
  const [isReconnecting, setIsReconnecting] = useState(false);

  const reconnect = transportStore?.reconnect;
  const isConnecting = transportStore?.isConnecting ?? false;
  const canReconnect = transportStore?.canReconnect?.() ?? false;
  const reconnectDisabled = isReconnecting || isConnecting || !canReconnect;

  const handleReconnect = useCallback(async () => {
    if (reconnectDisabled || !reconnect || !transportStore) return;
    
    setIsReconnecting(true);
    try {
      await reconnect();
      
      // 等待一小段时间让连接状态更新
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 检查实际的连接状态
      const isNowConnected = transportStore.isConnected();
      
      if (isNowConnected) {
        toast.success(_(msg`Reconnected successfully`));
      } else {
        // 连接失败，但会自动重试
        toast.info(_(msg`Connection failed, will retry automatically`));
      }
    } catch (error) {
      toast.error(_(msg`Failed to reconnect`), error instanceof Error ? error.message : String(error));
      console.error('Reconnection failed:', error);
    } finally {
      setIsReconnecting(false);
    }
  }, [reconnect, reconnectDisabled, transportStore, toast, _]);

  return (
    <div className={styles.statusBar}>
      <span className={connected ? styles.statusConnected : styles.statusDisconnected}>
        {connected ? <Trans>Connected</Trans> : <Trans>Disconnected</Trans>}
      </span>
      <span className={styles.statusMeta}>
        <span><Trans>Time Step:</Trans></span>
        <span className={styles.metricValue}>{currentTime == null ? 'N/A' : currentTime}</span>
      </span>
      <span className={styles.statusMeta}>
        <span><Trans>TPS:</Trans></span>
        <span className={styles.metricValue}>{runtimeTps == null ? 'N/A' : runtimeTps.toFixed(1)}</span>
      </span>
      <span className={styles.statusMeta}>
        <span><Trans>MSPT:</Trans></span>
        <span className={styles.metricValue}>{runtimeMspt == null ? 'N/A' : runtimeMspt.toFixed(1)}</span>
      </span>
      <span className={styles.statusMeta}>
        <span><Trans>Model:</Trans></span>
        <span className={styles.metricValue}>{simulatorMspt == null ? 'N/A' : simulatorMspt.toFixed(1)}</span>
      </span>
      {simulatorCommMs != null && (
        <span className={styles.statusMeta}>
          <span><Trans>Comm:</Trans></span>
          <span className={styles.metricValue}>{simulatorCommMs.toFixed(1)}</span>
        </span>
      )}
      {simulatorRenderMs != null && (
        <span className={styles.statusMeta}>
          <span><Trans>Srv Render:</Trans></span>
          <span className={styles.metricValue}>{simulatorRenderMs.toFixed(1)}</span>
        </span>
      )}
      
      <div className={styles.buttonGroup}>
        <button
          onClick={handleReconnect}
          className={styles.toggleButton}
          disabled={reconnectDisabled}
          title={_(msg`Force reconnect to server`)}
          style={{
            opacity: reconnectDisabled ? 0.5 : 1,
            cursor: reconnectDisabled ? 'not-allowed' : 'pointer',
          }}
        >
          <RefreshCw 
            size={16}
            className={isReconnecting || isConnecting ? 'spinning-icon' : ''}
          />
          <span><Trans>Reconnect</Trans></span>
        </button>

        <button
          onClick={() => setSettingsDialogOpen(true)}
          className={styles.toggleButton}
          title={_(msg`Settings`)}
        >
          <Wrench size={16} />
          <span><Trans>Settings</Trans></span>
        </button>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          .spinning-icon {
            animation: spin 1s linear infinite;
          }
        `}</style>
        
        {onToggleRightPanel && (
          <button
            onClick={onToggleRightPanel}
            className={styles.toggleButton}
            title={rightPanelVisible ? _(msg`Hide Right Panel`) : _(msg`Show Right Panel`)}
          >
            {rightPanelVisible ? <PanelRightClose size={16} /> : <PanelRight size={16} />}
          </button>
        )}
        {onToggleBottomPanel && (
          <button
            onClick={onToggleBottomPanel}
            className={styles.toggleButton}
            title={bottomPanelVisible ? _(msg`Hide Bottom Panel`) : _(msg`Show Bottom Panel`)}
          >
            {bottomPanelVisible ? <PanelBottomClose size={16} /> : <PanelBottom size={16} />}
          </button>
        )}
      </div>
    </div>
  )
}
