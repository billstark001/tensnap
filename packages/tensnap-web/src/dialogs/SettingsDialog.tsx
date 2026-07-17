import React, { useState, useCallback, useMemo } from 'react';
import * as Dialog from '@tensnap/web-common/components/ui/Dialog';
import * as Select from '@tensnap/web-common/components/ui/Select';
import * as Switch from '@radix-ui/react-switch';
import { DialogOpenProps } from '@tensnap/web-common/react';
import { ACTION_TIMEOUT_SECONDS_OPTIONS, MAX_SNAPSHOT_PLAYBACK_FPS, useSettingsStore } from '@/store/settings';
import { useProjectStore } from '@/store/project';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { activateLocale, locales, isValidLocale } from '@/i18n';
import { useToast } from '@/store/toast';
import type { ProjectSource } from '@tensnap/core/snapshot';
import { listBuiltinModels } from '@/transport';

import * as styles from './SettingsDialog.css';
import Form from '@tensnap/web-common/components/ui/Form';

export const SettingsDialog: React.FC<DialogOpenProps> = ({
  open,
  onOpenChange,
}) => {
  const { _ } = useLingui();
  const toast = useToast();

  const {
    theme,
    saveFormat,
    locale,
    clientMessageValidation,
    serverMessageValidation,
    renderTriggerMode,
    maxTps,
    maxRenderFps,
    snapshotPlaybackFps,
    actionTimeoutSeconds,
    setSaveFormat,
    toggleTheme,
    setLocale,
    setClientMessageValidation,
    setServerMessageValidation,
    setRenderTriggerMode,
    setMaxTps,
    setMaxRenderFps,
    setSnapshotPlaybackFps,
    setActionTimeoutSeconds,
  } = useSettingsStore();

  const { activeProject, activeIndex, changeSource } = useProjectStore();
  const activeProjectId = activeProject?.id ?? null;
  const currentProjectSource = useMemo<ProjectSource>(
    () => activeProject?.source ?? { kind: 'websocket', url: 'ws://localhost:8765' },
    [activeProject?.source],
  );
  const builtinModels = useMemo(() => listBuiltinModels(), []);
  const snapshots = activeProject?.useScenarioStore.getState().snapshots ?? [];

  // Project settings local state
  const [projectDraft, setProjectDraft] = useState(() => ({
    projectId: activeProjectId,
    source: structuredClone(currentProjectSource),
    hasProjectChanges: false,
  }));

  const projectSource = projectDraft.projectId === activeProjectId
    ? projectDraft.source
    : currentProjectSource;
  const hasProjectChanges = projectDraft.projectId === activeProjectId
    ? projectDraft.hasProjectChanges
    : false;

  const updateProjectSource = useCallback((source: ProjectSource) => {
    setProjectDraft({
      projectId: activeProjectId,
      source,
      hasProjectChanges: JSON.stringify(source) !== JSON.stringify(currentProjectSource),
    });
  }, [activeProjectId, currentProjectSource]);

  const handleProjectSettingsConfirm = useCallback(async () => {
    if (!activeProject || activeIndex === null) {
      toast.error(_(msg`No active project`));
      return;
    }

    try {
      await changeSource(activeIndex, projectSource);
      toast.success(_(msg`Project source updated successfully`));
      setProjectDraft({
        projectId: activeProjectId,
        source: structuredClone(projectSource),
        hasProjectChanges: false,
      });
    } catch (error) {
      toast.error(_(msg`Failed to update project source`), error instanceof Error ? error.message : String(error));
      console.error('Failed to update project source:', error);
    }
  }, [activeIndex, activeProject, activeProjectId, projectSource, changeSource, toast, _]);

  const handleProjectSettingsReset = useCallback(() => {
    setProjectDraft({
      projectId: activeProjectId,
      source: structuredClone(currentProjectSource),
      hasProjectChanges: false,
    });
  }, [activeProjectId, currentProjectSource]);

  const handleLocaleChange = useCallback(async (newLocale: string) => {
    if (!isValidLocale(newLocale)) {
      toast.error(_(msg`Invalid locale`), newLocale);
      return;
    }
    await activateLocale(newLocale);
    setLocale(newLocale);
  }, [_, setLocale, toast]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} size="lg">
      <Dialog.Title><Trans>Settings</Trans></Dialog.Title>
      <Dialog.Description className={styles.visuallyHidden}>
        <Trans>Configure application and project settings.</Trans>
      </Dialog.Description>

      <div className={styles.settingsContainer}>
        {/* System Settings */}
        <div className={styles.sectionContainer}>
          <h3 className={styles.sectionTitle}><Trans>System Settings</Trans></h3>

          <div className={styles.systemSettingsGrid}>
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
                {Object.entries(locales).map(([code, name]) => (
                  <Select.Item key={code} value={code} >
                    {name}
                  </Select.Item>
                ))}
              </Select.Root>
            </div>
          </div>

          <div className={styles.settingItem}>
            <label className={styles.settingLabel}><Trans>Save Format</Trans></label>
            <div className={styles.settingControl}>
              <Select.Root value={saveFormat} onValueChange={setSaveFormat}>
                <Select.Item value="msgpack" >
                  MessagePack
                </Select.Item>
                <Select.Item value="json" >
                  JSON
                </Select.Item>
              </Select.Root>
            </div>
          </div>

          <div className={styles.settingItem}>
            <label className={styles.settingLabel}><Trans>Client Message Validation</Trans></label>
            <div className={styles.settingControl}>
              <Select.Root value={clientMessageValidation} onValueChange={(value) => setClientMessageValidation(value as 'off' | 'warning' | 'error')}>
                <Select.Item value="off" >
                  <Trans>Off</Trans>
                </Select.Item>
                <Select.Item value="warning" >
                  <Trans>Warning</Trans>
                </Select.Item>
                <Select.Item value="error" >
                  <Trans>Error</Trans>
                </Select.Item>
              </Select.Root>
            </div>
          </div>

          <div className={styles.settingItem}>
            <label className={styles.settingLabel}><Trans>Server Message Validation</Trans></label>
            <div className={styles.settingControl}>
              <Select.Root value={serverMessageValidation} onValueChange={(value) => setServerMessageValidation(value as 'off' | 'warning' | 'error')}>
                <Select.Item value="off" >
                  <Trans>Off</Trans>
                </Select.Item>
                <Select.Item value="warning" >
                  <Trans>Warning</Trans>
                </Select.Item>
                <Select.Item value="error" >
                  <Trans>Error</Trans>
                </Select.Item>
              </Select.Root>
            </div>
          </div>

          <div className={styles.settingItem}>
            <label className={styles.settingLabel}><Trans>Render Trigger</Trans></label>
            <div className={styles.settingControl}>
              <Select.Root value={renderTriggerMode} onValueChange={(value) => setRenderTriggerMode(value as 'auto' | 'setTimeout' | 'requestAnimationFrame')}>
                <Select.Item value="auto">
                  <Trans>Auto</Trans>
                </Select.Item>
                <Select.Item value="setTimeout">
                  setTimeout
                </Select.Item>
                <Select.Item value="requestAnimationFrame">
                  requestAnimationFrame
                </Select.Item>
              </Select.Root>
            </div>
          </div>

          <div className={styles.settingItem}>
            <label className={styles.settingLabel}><Trans>Max TPS</Trans></label>
            <div className={styles.settingControl}>
              <div>
                <Form.Input
                  type="number"
                  min={0}
                  step={1}
                  value={maxTps}
                  onChange={(e) => setMaxTps(Number(e.target.value))}
                />
                <div className={styles.fieldHint}>
                  <Trans>0 means unlimited</Trans>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.settingItem}>
            <label className={styles.settingLabel}><Trans>Max FPS</Trans></label>
            <div className={styles.settingControl}>
              <div>
                <Form.Input
                  type="number"
                  min={0}
                  step={1}
                  value={maxRenderFps}
                  onChange={(e) => setMaxRenderFps(Number(e.target.value))}
                />
                <div className={styles.fieldHint}>
                  <Trans>0 means unlimited</Trans>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.settingItem}>
            <label className={styles.settingLabel}><Trans>Snapshot playback FPS</Trans></label>
            <div className={styles.settingControl}>
              <div>
                <Form.Input
                  type="number"
                  min={1}
                  max={MAX_SNAPSHOT_PLAYBACK_FPS}
                  step={1}
                  value={snapshotPlaybackFps}
                  onChange={(e) => setSnapshotPlaybackFps(Number(e.target.value))}
                />
                <div className={styles.fieldHint}>
                  <Trans>Maximum 120 FPS</Trans>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.settingItem}>
            <label className={styles.settingLabel}><Trans>Action Timeout</Trans></label>
            <div className={styles.settingControl}>
              <Select.Root
                value={String(actionTimeoutSeconds)}
                onValueChange={(value) => setActionTimeoutSeconds(Number(value))}
              >
                {ACTION_TIMEOUT_SECONDS_OPTIONS.map((seconds) => (
                  <Select.Item key={seconds} value={String(seconds)}>
                    {seconds}s
                  </Select.Item>
                ))}
              </Select.Root>
            </div>
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
                  <Form.Label><Trans>Project File</Trans></Form.Label>
                  <Form.Input
                    className={styles.projectPathInput}
                    type="text"
                    value={activeProject.filepath ?? ''}
                    readOnly
                    title={activeProject.filepath ?? _(msg`Unsaved project`)}
                    placeholder={_(msg`Unsaved project`)}
                  />
                  <div className={styles.fieldHint}>
                    <Trans>The full path is shown here and is not editable.</Trans>
                  </div>
                </Form.FieldSet>
                <Form.FieldSet>
                  <Form.Label><Trans>Project Source</Trans></Form.Label>
                  <Select.Root
                    value={projectSource.kind}
                    onValueChange={(kind) => {
                      if (kind === 'websocket') updateProjectSource({ kind, url: projectSource.kind === 'websocket' ? projectSource.url : 'ws://localhost:8765' });
                      if (kind === 'inmemory') updateProjectSource({ kind, model_id: projectSource.kind === 'inmemory' ? projectSource.model_id : builtinModels[0]?.id ?? '' });
                      if (kind === 'snapshot') updateProjectSource({ kind, snapshot_id: projectSource.kind === 'snapshot' ? projectSource.snapshot_id : snapshots[0]?.metadata.id ?? '' });
                    }}
                  >
                    <Select.Item value="websocket"><Trans>WebSocket simulator</Trans></Select.Item>
                    <Select.Item value="inmemory"><Trans>Built-in browser model</Trans></Select.Item>
                    <Select.Item value="snapshot" disabled={!snapshots.length}><Trans>Snapshot playback</Trans></Select.Item>
                  </Select.Root>
                </Form.FieldSet>
                {projectSource.kind === 'websocket' && <Form.FieldSet>
                  <Form.Label><Trans>Backend URL</Trans></Form.Label>
                  <Form.Input type="text" value={projectSource.url} onChange={(e) => updateProjectSource({ kind: 'websocket', url: e.target.value })} placeholder={_(msg`Enter backend WebSocket server address`)} />
                  <div className={styles.fieldHint}><Trans>Change the WebSocket server URL for the current project. The connection will be reestablished.</Trans></div>
                </Form.FieldSet>}
                {projectSource.kind === 'inmemory' && <Form.FieldSet>
                  <Form.Label><Trans>Built-in model</Trans></Form.Label>
                  <Select.Root value={projectSource.model_id} onValueChange={(model_id) => updateProjectSource({ kind: 'inmemory', model_id })}>
                    {builtinModels.map((model) => <Select.Item key={model.id} value={model.id}>{model.name}</Select.Item>)}
                  </Select.Root>
                  <div className={styles.fieldHint}><Trans>This project runs a local JavaScript simulator in the browser.</Trans></div>
                </Form.FieldSet>}
                {projectSource.kind === 'snapshot' && <Form.FieldSet>
                  <Form.Label><Trans>Snapshot</Trans></Form.Label>
                  <Select.Root value={projectSource.snapshot_id} onValueChange={(snapshot_id) => updateProjectSource({ kind: 'snapshot', snapshot_id })}>
                    {snapshots.map((snapshot) => <Select.Item key={snapshot.metadata.id} value={snapshot.metadata.id}>{snapshot.metadata.label || snapshot.metadata.id}</Select.Item>)}
                  </Select.Root>
                  <div className={styles.fieldHint}><Trans>Snapshot sources are disconnected and permit playback controls only.</Trans></div>
                </Form.FieldSet>}
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
