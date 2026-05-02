import { useContext } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useFileOperations } from './useFileOperations';
import * as styles from '@/styles/toolbar.css';
import { useSettingsStore } from '@/store/settings';
import clsx from 'clsx';
import { Trans } from '@lingui/react/macro';
import { MenuBarContext } from './MenuBarContext';

export interface MenuBarProps {
  className?: string;
}

export const MenuBar: React.FC<MenuBarProps> = ({
  className,
}) => {
  const {
    canSaveFile,
    onNewFile, onFileOpen,
    onFileSave, onFileSaveAs,
  } = useFileOperations();

  const setSettingsDialogOpen = useSettingsStore(x => x.setSettingsDialogOpen);
  const setAboutDialogOpen = useSettingsStore(x => x.setAboutDialogOpen);

  const { environment, system } = useContext(MenuBarContext);

  return (
    <>
      <div className={clsx(
        styles.menuBar,
        environment === 'tauri' && system === 'mac' && 'mac',
        className
      )} data-tauri-drag-region>
        {/* File Menu */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className={styles.menuItem}><Trans>File</Trans></button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className={styles.dropdownContent}
              sideOffset={5}
            >
              <DropdownMenu.Item
                className={styles.dropdownItem}
                onClick={onNewFile}
              >
                <Trans>New</Trans>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={styles.dropdownItem}
                onClick={onFileOpen}
              >
                <Trans>Open File</Trans>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={styles.dropdownItem}
                onClick={canSaveFile ? onFileSave : undefined}
                disabled={!canSaveFile}
              >
                <Trans>Save</Trans>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={styles.dropdownItem}
                onClick={canSaveFile ? onFileSaveAs : undefined}
                disabled={!canSaveFile}
              >
                <Trans>Save As...</Trans>
              </DropdownMenu.Item>

              <DropdownMenu.Separator className={styles.dropdownSeparator} />
              <DropdownMenu.Item className={styles.dropdownItem}>
                <Trans>Exit</Trans>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        {/* Edit Menu */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className={styles.menuItem}><Trans>Edit</Trans></button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className={styles.dropdownContent}
              sideOffset={5}
            >
              <DropdownMenu.Item className={styles.dropdownItem}>
                <Trans>Undo</Trans>
              </DropdownMenu.Item>
              <DropdownMenu.Item className={styles.dropdownItem}>
                <Trans>Redo</Trans>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={styles.dropdownSeparator} />
              <DropdownMenu.Item className={styles.dropdownItem}>
                <Trans>Cut</Trans>
              </DropdownMenu.Item>
              <DropdownMenu.Item className={styles.dropdownItem}>
                <Trans>Copy</Trans>
              </DropdownMenu.Item>
              <DropdownMenu.Item className={styles.dropdownItem}>
                <Trans>Paste</Trans>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={styles.dropdownSeparator} />
              <DropdownMenu.Item className={styles.dropdownItem}>
                <Trans>Select All</Trans>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        {/* View Menu */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className={styles.menuItem}><Trans>View</Trans></button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className={styles.dropdownContent}
              sideOffset={5}
            >
              <DropdownMenu.Item className={styles.dropdownItem}>
                <Trans>Zoom In</Trans>
              </DropdownMenu.Item>
              <DropdownMenu.Item className={styles.dropdownItem}>
                <Trans>Zoom Out</Trans>
              </DropdownMenu.Item>
              <DropdownMenu.Item className={styles.dropdownItem}>
                <Trans>Reset Zoom</Trans>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={styles.dropdownSeparator} />
              <DropdownMenu.Item className={styles.dropdownItem}>
                <Trans>Show Grid</Trans>
              </DropdownMenu.Item>
              <DropdownMenu.Item className={styles.dropdownItem}>
                <Trans>Show Toolbar</Trans>
              </DropdownMenu.Item>

              <DropdownMenu.Item className={styles.dropdownItem}>
                <Trans>Fullscreen</Trans>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        {/* Tools Menu */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className={styles.menuItem}><Trans>Tools</Trans></button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className={styles.dropdownContent}
              sideOffset={5}
            >

              <DropdownMenu.Item
                className={styles.dropdownItem}
                onClick={() => setSettingsDialogOpen(true)}
              >
                <Trans>Settings</Trans>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={styles.dropdownSeparator} />

            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        {/* Help Menu */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className={styles.menuItem}><Trans>Help</Trans></button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className={styles.dropdownContent}
              sideOffset={5}
            >
              <DropdownMenu.Item className={styles.dropdownItem}>
                <Trans>Documentation</Trans>
              </DropdownMenu.Item>
              <DropdownMenu.Item className={styles.dropdownItem}>
                <Trans>Keyboard Shortcuts</Trans>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={styles.dropdownSeparator} />
              <DropdownMenu.Item
                className={styles.dropdownItem}
                onClick={() => setAboutDialogOpen(true)}
              >
                <Trans>About TenSnap</Trans>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

    </>
  );
};
