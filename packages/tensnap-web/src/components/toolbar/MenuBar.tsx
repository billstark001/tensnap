import React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as styles from '../../styles/toolbar.css';

export interface MenuBarProps {
  className?: string;
}

export const MenuBar: React.FC<MenuBarProps> = ({ className }) => {
  return (
    <div className={`${styles.menuBar} ${className || ''}`}>
      {/* File 菜单 */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className={styles.menuItem}>File</button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className={styles.dropdownContent}
            sideOffset={5}
          >
            <DropdownMenu.Item className={styles.dropdownItem}>
              New
            </DropdownMenu.Item>
            <DropdownMenu.Item className={styles.dropdownItem}>
              Open
            </DropdownMenu.Item>
            <DropdownMenu.Item className={styles.dropdownItem}>
              Save
            </DropdownMenu.Item>
            <DropdownMenu.Item className={styles.dropdownItem}>
              Save As...
            </DropdownMenu.Item>
            <DropdownMenu.Separator className={styles.dropdownSeparator} />
            <DropdownMenu.Item className={styles.dropdownItem}>
              Export
            </DropdownMenu.Item>
            <DropdownMenu.Separator className={styles.dropdownSeparator} />
            <DropdownMenu.Item className={styles.dropdownItem}>
              Exit
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* Edit 菜单 */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className={styles.menuItem}>Edit</button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className={styles.dropdownContent}
            sideOffset={5}
          >
            <DropdownMenu.Item className={styles.dropdownItem}>
              Undo
            </DropdownMenu.Item>
            <DropdownMenu.Item className={styles.dropdownItem}>
              Redo
            </DropdownMenu.Item>
            <DropdownMenu.Separator className={styles.dropdownSeparator} />
            <DropdownMenu.Item className={styles.dropdownItem}>
              Cut
            </DropdownMenu.Item>
            <DropdownMenu.Item className={styles.dropdownItem}>
              Copy
            </DropdownMenu.Item>
            <DropdownMenu.Item className={styles.dropdownItem}>
              Paste
            </DropdownMenu.Item>
            <DropdownMenu.Separator className={styles.dropdownSeparator} />
            <DropdownMenu.Item className={styles.dropdownItem}>
              Select All
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* View 菜单 */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className={styles.menuItem}>View</button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className={styles.dropdownContent}
            sideOffset={5}
          >
            <DropdownMenu.Item className={styles.dropdownItem}>
              Zoom In
            </DropdownMenu.Item>
            <DropdownMenu.Item className={styles.dropdownItem}>
              Zoom Out
            </DropdownMenu.Item>
            <DropdownMenu.Item className={styles.dropdownItem}>
              Reset Zoom
            </DropdownMenu.Item>
            <DropdownMenu.Separator className={styles.dropdownSeparator} />
            <DropdownMenu.Item className={styles.dropdownItem}>
              Show Grid
            </DropdownMenu.Item>
            <DropdownMenu.Item className={styles.dropdownItem}>
              Show Toolbar
            </DropdownMenu.Item>
            <DropdownMenu.Item className={styles.dropdownItem}>
              Full Screen
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* About 菜单 */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className={styles.menuItem}>About</button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className={styles.dropdownContent}
            sideOffset={5}
          >
            <DropdownMenu.Item className={styles.dropdownItem}>
              Help
            </DropdownMenu.Item>
            <DropdownMenu.Item className={styles.dropdownItem}>
              Documentation
            </DropdownMenu.Item>
            <DropdownMenu.Separator className={styles.dropdownSeparator} />
            <DropdownMenu.Item className={styles.dropdownItem}>
              About TenSnap
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
};
