import React, { useState, useCallback } from 'react';
import * as Dialog from '@/components/ui/Dialog';
import * as Switch from '@radix-ui/react-switch';
import * as Select from '@radix-ui/react-select';
import { DialogOpenProps } from '@/utils/react';
import { useSettingsStore } from '@/store/settings';
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

  // Project settings local state
  const [backendUrl, setBackendUrl] = useState('http://localhost:5678');
  const [hasProjectChanges, setHasProjectChanges] = useState(false);

  const handleBackendUrlChange = useCallback((value: string) => {
    setBackendUrl(value);
    setHasProjectChanges(true);
  }, []);

  const handleProjectSettingsConfirm = useCallback(() => {
    // TODO: Implementation for actual project settings save logic
    toast.info('Save project settings', `Backend URL: ${backendUrl}`);
    setHasProjectChanges(false);
  }, [backendUrl, toast]);

  const handleProjectSettingsReset = useCallback(() => {
    setBackendUrl('http://localhost:5678');
    setHasProjectChanges(false);
  }, []);

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
                <Trans>Confirm Changes</Trans>
              </Dialog.Button>
            </div>
          </div>
        </div>
      </div>

      <Dialog.Footer>
        <Dialog.Close asChild>
          <Dialog.Button><Trans>Close</Trans></Dialog.Button>
        </Dialog.Close>
      </Dialog.Footer>
    </Dialog.Root>
  );
};
