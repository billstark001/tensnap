import React, { useState, useCallback, useEffect } from 'react';
import * as Dialog from '@/components/ui/Dialog';
import * as Switch from '@radix-ui/react-switch';
import * as Select from '@radix-ui/react-select';
import { DialogOpenProps } from '@/utils/react';
import { useSettingsStore } from '@/store/settings';
import { useProjectStore } from '@/store/project';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { activateLocale, locales, isValidLocale } from '@/i18n';
import { useToast } from '@/store/toast';

import * as styles from './SettingsDialog.css';
import Form from '@/components/ui/Form';

export interface SettingsDialogProps extends DialogOpenProps {

}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { _ } = useLingui();
  const toast = useToast();

  const {
    theme,
    saveFormat,
    locale,
    setSaveFormat,
    toggleTheme,
    setLocale,
  } = useSettingsStore();

  const { activeProject, activeIndex, changeUrl } = useProjectStore();

  // Project settings local state
  const [backendUrl, setBackendUrl] = useState('');
  const [hasProjectChanges, setHasProjectChanges] = useState(false);

  // 同步当前项目的 URL
  useEffect(() => {
    if (activeProject) {
      const currentUrl = activeProject.useWebSocketStore.getState().url || '';
      setBackendUrl(currentUrl);
      setHasProjectChanges(false);
    } else {
      setBackendUrl('');
      setHasProjectChanges(false);
    }
  }, [activeProject]);

  const handleBackendUrlChange = useCallback((value: string) => {
    setBackendUrl(value);
    const currentUrl = activeProject?.useWebSocketStore.getState().url || '';
    setHasProjectChanges(value !== currentUrl);
  }, [activeProject]);

  const handleProjectSettingsConfirm = useCallback(async () => {
    if (!activeProject || activeIndex === null) {
      toast.error(_(msg`No active project`));
      return;
    }

    try {
      await changeUrl(activeIndex, backendUrl);
      toast.success(_(msg`Project URL updated successfully`));
      setHasProjectChanges(false);
    } catch (error) {
      toast.error(_(msg`Failed to update project URL`), error instanceof Error ? error.message : String(error));
      console.error('Failed to update project URL:', error);
    }
  }, [activeIndex, backendUrl, changeUrl, toast, _, activeProject]);

  const handleProjectSettingsReset = useCallback(() => {
    if (activeProject) {
      const currentUrl = activeProject.useWebSocketStore.getState().url || '';
      setBackendUrl(currentUrl);
    } else {
      setBackendUrl('');
    }
    setHasProjectChanges(false);
  }, [activeProject]);

  const handleLocaleChange = useCallback(async (newLocale: string) => {
    if (!isValidLocale(newLocale)) {
      toast.error('Invalid locale', newLocale);
      return;
    }
    await activateLocale(newLocale);
    setLocale(newLocale);
  }, [setLocale, toast]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Title><Trans>Settings</Trans></Dialog.Title>
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

        <Dialog.Separator />

        {/* Project Settings */}
        {activeProject && (
          <div className={styles.sectionContainer}>
            <h3 className={styles.sectionTitle}><Trans>Project Settings</Trans></h3>

            <div className={styles.projectSettingsContainer}>
              <div className={styles.projectSettingsForm}>
                <Form.FieldSet>
                  <Form.Label><Trans>Backend URL</Trans></Form.Label>
                  <Form.Input
                    type="text"
                    value={backendUrl}
                    onChange={(e) => handleBackendUrlChange(e.target.value)}
                    placeholder={_(msg`Enter backend WebSocket server address`)}
                  />
                  <div style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginTop: '0.5rem' }}>
                    <Trans>Change the WebSocket server URL for the current project. The connection will be reestablished.</Trans>
                  </div>
                </Form.FieldSet>
              </div>

              <div className={styles.projectSettingsFooter}>
                <Dialog.Button
                  onClick={handleProjectSettingsReset}
                  disabled={!hasProjectChanges}
                >
                  <Trans>Reset</Trans>
                </Dialog.Button>
                <Dialog.Button
                  variant="primary"
                  onClick={handleProjectSettingsConfirm}
                  disabled={!hasProjectChanges}
                >
                  <Trans>Apply</Trans>
                </Dialog.Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <Dialog.Footer>
        <Dialog.Close asChild>
          <Dialog.Button><Trans>Close</Trans></Dialog.Button>
        </Dialog.Close>
      </Dialog.Footer>
    </Dialog.Root>
  );
};
