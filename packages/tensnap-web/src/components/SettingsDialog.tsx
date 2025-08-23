import React, { useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Switch from '@radix-ui/react-switch';
import * as Select from '@radix-ui/react-select';
import * as dialogStyles from '@/styles/dialog.css';
import { DialogOpenProps } from '@/utils/react';
import { useSettingsStore } from '@/store/settings';

import * as styles from './SettingsDialog.css';

export interface SettingsDialogProps extends DialogOpenProps {

}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  open,
  onOpenChange,
}) => {

  const {
    theme,
    saveFormat,
    setSaveFormat,
    toggleTheme,
  } = useSettingsStore();

  // 项目设置的本地状态
  const [backendUrl, setBackendUrl] = useState('http://localhost:5678');
  const [hasProjectChanges, setHasProjectChanges] = useState(false);

  const handleBackendUrlChange = useCallback((value: string) => {
    setBackendUrl(value);
    setHasProjectChanges(true);
  }, []);

  const handleProjectSettingsConfirm = useCallback(() => {
    // TODO: 这里将来会实现实际的项目设置保存逻辑
    console.log('保存项目设置:', { backendUrl });
    setHasProjectChanges(false);
  }, [backendUrl]);

  const handleProjectSettingsReset = useCallback(() => {
    setBackendUrl('http://localhost:5678');
    setHasProjectChanges(false);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogStyles.dialogOverlay} />
        <Dialog.Content className={dialogStyles.dialogContentLarge}>
          <Dialog.Title className={dialogStyles.dialogTitle}>设置</Dialog.Title>
          <Dialog.Description></Dialog.Description>
          
          <div className={styles.settingsContainer}>
            {/* 系统设置 */}
            <div className={styles.sectionContainer}>
              <h3 className={styles.sectionTitle}>系统设置</h3>
              
              <div className={styles.settingItem}>
                <label className={styles.settingLabel}>主题模式</label>
                <div className={styles.settingControl}>
                  <div className={styles.switchContainer}>
                    <Switch.Root
                      className={styles.switchRoot}
                      checked={theme === 'dark'}
                      onCheckedChange={toggleTheme}
                    >
                      <Switch.Thumb className={styles.switchThumb} />
                    </Switch.Root>
                    <span style={{ marginLeft: '8px', fontSize: '12px' }}>
                      {theme === 'dark' ? '深色' : '浅色'}
                    </span>
                  </div>
                </div>
              </div>

              <div className={styles.settingItem}>
                <label className={styles.settingLabel}>存储格式</label>
                <div className={styles.settingControl}>
                  <Select.Root value={saveFormat} onValueChange={setSaveFormat}>
                    <Select.Trigger className={styles.selectTrigger}>
                      <Select.Value />
                      <Select.Icon>▼</Select.Icon>
                    </Select.Trigger>
                    <Select.Portal>
                      <Select.Content className={styles.selectContent}>
                        <Select.Item value="msgpack" className={styles.selectItem}>
                          <Select.ItemText>MessagePack</Select.ItemText>
                        </Select.Item>
                        <Select.Item value="json" className={styles.selectItem}>
                          <Select.ItemText>JSON</Select.ItemText>
                        </Select.Item>
                      </Select.Content>
                    </Select.Portal>
                  </Select.Root>
                </div>
              </div>
            </div>

            <div className={dialogStyles.dialogSeparator} />

            {/* 项目设置 */}
            <div className={styles.sectionContainer}>
              <h3 className={styles.sectionTitle}>项目设置</h3>
              
              <div className={styles.projectSettingsContainer}>
                <div className={styles.projectSettingsForm}>
                  <fieldset className={dialogStyles.dialogFieldset}>
                    <label className={dialogStyles.dialogLabel}>后端地址</label>
                    <input
                      type="text"
                      value={backendUrl}
                      onChange={(e) => handleBackendUrlChange(e.target.value)}
                      className={dialogStyles.dialogInput}
                      placeholder="输入后端WebSocket服务器地址"
                    />
                  </fieldset>
                </div>

                <div className={styles.projectSettingsFooter}>
                  <button 
                    className={dialogStyles.dialogButton}
                    onClick={handleProjectSettingsReset}
                    disabled={!hasProjectChanges}
                  >
                    重置
                  </button>
                  <button 
                    className={dialogStyles.dialogButtonPrimary}
                    onClick={handleProjectSettingsConfirm}
                    disabled={!hasProjectChanges}
                  >
                    确认更改
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className={dialogStyles.dialogFooter}>
            <Dialog.Close asChild>
              <button className={dialogStyles.dialogButton}>关闭</button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
