import React, { useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useFileSystem } from '../../store/file-system/provider';
import * as dialogStyles from '../../styles/dialog.css';

export interface ExportOption {
  key: string;
  title: string;
  description: string;
  format: 'json' | 'zip' | 'other';
  handler: () => Promise<void> | void;
}

export interface ExportDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  customOptions?: ExportOption[];
  showDefaultOptions?: boolean;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({
  isOpen,
  onOpenChange,
  title = "导出选项",
  customOptions = [],
  showDefaultOptions = true
}) => {
  const fileSystem = useFileSystem();
  const { currentDirectory, exportDirectory } = fileSystem;

  const handleExportDirectory = useCallback(async (format: 'json' | 'zip') => {
    try {
      const blob = await exportDirectory(currentDirectory, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `export-${currentDirectory.replace(/\//g, '-')}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to export directory:', error);
    }
  }, [exportDirectory, currentDirectory, onOpenChange]);

  const defaultOptions: ExportOption[] = [
    {
      key: 'zip',
      title: 'ZIP 压缩包',
      description: '包含所有文件的压缩包',
      format: 'zip',
      handler: () => handleExportDirectory('zip')
    },
    {
      key: 'json',
      title: 'JSON 数据',
      description: '结构化数据格式',
      format: 'json',
      handler: () => handleExportDirectory('json')
    }
  ];

  const allOptions = showDefaultOptions 
    ? [...defaultOptions, ...customOptions]
    : customOptions;

  const handleOptionClick = useCallback(async (option: ExportOption) => {
    try {
      await option.handler();
    } catch (error) {
      console.error(`Failed to execute export option ${option.key}:`, error);
    }
  }, []);

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogStyles.dialogOverlay} />
        <Dialog.Content className={dialogStyles.dialogContent} aria-describedby="导出选项">
          <Dialog.Title className={dialogStyles.dialogTitle}>
            {title}
          </Dialog.Title>

          <div>
            <fieldset className={dialogStyles.dialogFieldset}>
              <label className={dialogStyles.dialogLabel}>
                导出格式
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {allOptions.map((option) => (
                  <button
                    key={option.key}
                    className={dialogStyles.dialogButton}
                    style={{
                      padding: '12px',
                      textAlign: 'left',
                      justifyContent: 'flex-start',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: '4px'
                    }}
                    onClick={() => handleOptionClick(option)}
                  >
                    <div style={{ fontWeight: '500' }}>{option.title}</div>
                    <div style={{ fontSize: '12px', color: '#666666' }}>
                      {option.description}
                    </div>
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <div className={dialogStyles.dialogFooter}>
            <Dialog.Close asChild>
              <button className={dialogStyles.dialogButton}>
                取消
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
