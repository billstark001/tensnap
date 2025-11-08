import React, { useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Switch from '@radix-ui/react-switch';
import * as Select from '@radix-ui/react-select';
import * as dialogStyles from '@/styles/dialog.css';
import { DialogOpenProps } from '@/utils/react';
import { useSettingsStore } from '@/store/settings';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { activateLocale, locales, isValidLocale } from '@/i18n';

import * as styles from './SettingsDialog.css';

export interface SettingsDialogProps extends DialogOpenProps {

}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { _ } = useLingui();

  const {
    theme,
    saveFormat,
    locale,
    setSaveFormat,
    toggleTheme,
    setLocale,
  } = useSettingsStore();

  // Project settings local state
  const [backendUrl, setBackendUrl] = useState('http://localhost:5678');
  const [hasProjectChanges, setHasProjectChanges] = useState(false);

  const handleBackendUrlChange = useCallback((value: string) => {
    setBackendUrl(value);
    setHasProjectChanges(true);
  }, []);

  const handleProjectSettingsConfirm = useCallback(() => {
    // TODO: Implementation for actual project settings save logic
    console.log('Save project settings:', { backendUrl });
    setHasProjectChanges(false);
  }, [backendUrl]);

  const handleProjectSettingsReset = useCallback(() => {
    setBackendUrl('http://localhost:5678');
    setHasProjectChanges(false);
  }, []);

  const handleLocaleChange = useCallback(async (newLocale: string) => {
    if (!isValidLocale(newLocale)) {
      console.error(`Invalid locale: ${newLocale}`);
      return;
    }
    await activateLocale(newLocale);
    setLocale(newLocale);
  }, [setLocale]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogStyles.dialogOverlay} />
        <Dialog.Content className={dialogStyles.dialogContentLarge}>
          <Dialog.Title className={dialogStyles.dialogTitle}><Trans>Settings</Trans></Dialog.Title>
          <Dialog.Description></Dialog.Description>

          <div className={styles.settingsContainer}>
            {/* System Settings */}
            <div className={styles.sectionContainer}>
              <h3 className={styles.sectionTitle}><Trans>System Settings</Trans></h3>

              <div className={styles.settingItem}>
                <label className={styles.settingLabel}><Trans>Theme</Trans></label>
                <div className={styles.settingControl}>
                  <div className={styles.switchContainer}>
                    <Switch.Root
                      className={styles.switchRoot}
                      checked={theme === 'dark'}
                      onCheckedChange={toggleTheme}
                    >
                      <Switch.Thumb className={styles.switchThumb} />
                    </Switch.Root>
                    <span className={styles.themeLabel}>
                      {theme === 'dark' ? <Trans>Dark</Trans> : <Trans>Light</Trans>}
                    </span>
                  </div>
                </div>
              </div>

              <div className={styles.settingItem}>
                <label className={styles.settingLabel}><Trans>Language</Trans></label>
                <div className={styles.settingControl}>
                  <Select.Root value={locale} onValueChange={handleLocaleChange}>
                    <Select.Trigger className={styles.selectTrigger}>
                      <Select.Value />
                      <Select.Icon>▼</Select.Icon>
                    </Select.Trigger>
                    <Select.Portal>
                      <Select.Content className={styles.selectContent} position='popper'>
                        {Object.entries(locales).map(([code, name]) => (
                          <Select.Item key={code} value={code} className={styles.selectItem}>
                            <Select.ItemText>{name}</Select.ItemText>
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Portal>
                  </Select.Root>
                </div>
              </div>

              <div className={styles.settingItem}>
                <label className={styles.settingLabel}><Trans>Save Format</Trans></label>
                <div className={styles.settingControl}>
                  <Select.Root value={saveFormat} onValueChange={setSaveFormat}>
                    <Select.Trigger className={styles.selectTrigger}>
                      <Select.Value />
                      <Select.Icon>▼</Select.Icon>
                    </Select.Trigger>
                    <Select.Portal>
                      <Select.Content className={styles.selectContent} position='popper'>
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

            {/* Project Settings */}
            <div className={styles.sectionContainer}>
              <h3 className={styles.sectionTitle}><Trans>Project Settings</Trans></h3>

              <div className={styles.projectSettingsContainer}>
                <div className={styles.projectSettingsForm}>
                  <fieldset className={dialogStyles.dialogFieldset}>
                    <label className={dialogStyles.dialogLabel}><Trans>Backend URL</Trans></label>
                    <input
                      type="text"
                      value={backendUrl}
                      onChange={(e) => handleBackendUrlChange(e.target.value)}
                      className={dialogStyles.dialogInput}
                      placeholder={_(msg`Enter backend WebSocket server address`)}
                    />
                  </fieldset>
                </div>

                <div className={styles.projectSettingsFooter}>
                  <button
                    className={dialogStyles.dialogButton}
                    onClick={handleProjectSettingsReset}
                    disabled={!hasProjectChanges}
                  >
                    <Trans>Reset</Trans>
                  </button>
                  <button
                    className={dialogStyles.dialogButtonPrimary}
                    onClick={handleProjectSettingsConfirm}
                    disabled={!hasProjectChanges}
                  >
                    <Trans>Confirm Changes</Trans>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className={dialogStyles.dialogFooter}>
            <Dialog.Close asChild>
              <button className={dialogStyles.dialogButton}><Trans>Close</Trans></button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
