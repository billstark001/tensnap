import React, { useCallback, useState } from 'react';
import { Dialog, Form } from '@tensnap/web-common/components/ui';
import { t } from '@lingui/core/macro';
import { DialogOpenProps, useCallbackRef } from '@tensnap/web-common/react';
import { FileSystemAdapter } from '@tensnap/web-common/types/file';
import { exportDirectory } from './export-utils';

export interface ExportOption {
  key: string;
  title: string;
  description: string;
  format: 'json' | 'zip' | 'other';
  handler: () => Promise<void> | void;
}

export interface ExportDialogProps extends DialogOpenProps {
  fileSystem: FileSystemAdapter;
  currentPath?: string;
  title?: string;
  customOptions?: ExportOption[];
  showDefaultOptions?: boolean;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({
  open: isOpen,
  onOpenChange: _onOpenChange,
  fileSystem,
  currentPath = '/',
  title = t`Export Options`,
  customOptions = [],
  showDefaultOptions = true
}) => {
  const onOpenChange = useCallbackRef(_onOpenChange);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExportDirectory = useCallback(async (format: 'json' | 'zip') => {
    setExporting(true);
    setError(null);

    try {
      const blob = await exportDirectory(fileSystem, currentPath, { format });
      
      // 创建下载链接
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `export-${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      onOpenChange(false);
    } catch (err) {
      console.error('Failed to export directory:', err);
      setError((err as Error).message || t`Failed to export`);
    } finally {
      setExporting(false);
    }
  }, [fileSystem, currentPath, onOpenChange]);

  const defaultOptions: ExportOption[] = [
    {
      key: 'json',
      title: t`JSON Format`,
      description: t`Export as JSON file with all file contents and metadata`,
      format: 'json',
      handler: () => handleExportDirectory('json')
    },
    {
      key: 'zip',
      title: t`ZIP Archive`,
      description: t`Export as ZIP compressed file, preserving directory structure`,
      format: 'zip',
      handler: () => handleExportDirectory('zip')
    }
  ];

  const allOptions = showDefaultOptions
    ? [...defaultOptions, ...customOptions]
    : customOptions;

  const handleOptionClick = useCallback(async (option: ExportOption) => {
    if (exporting) return;
    
    try {
      await option.handler();
    } catch (err) {
      console.error(`Failed to execute export option ${option.key}:`, err);
      setError((err as Error).message || t`Failed to execute export option`);
    }
  }, [exporting]);

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Title>
        {title}
      </Dialog.Title>
      <Dialog.Description>
        {t`Export path`}: {currentPath}
      </Dialog.Description>

      <div>
        {error && (
          <div style={{ 
            padding: '12px', 
            backgroundColor: '#ffebee', 
            color: '#c62828', 
            borderRadius: '6px',
            marginBottom: '16px'
          }}>
            {error}
          </div>
        )}

        <Form.FieldSet>
          <Form.Label>
            {t`Select export format`}
          </Form.Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {allOptions.map((option) => (
              <button
                key={option.key}
                disabled={exporting}
                style={{
                  padding: '12px',
                  textAlign: 'left',
                  border: '1px solid #e0e0e0',
                  borderRadius: '6px',
                  backgroundColor: '#ffffff',
                  cursor: exporting ? 'not-allowed' : 'pointer',
                  opacity: exporting ? 0.6 : 1,
                  transition: 'all 0.2s'
                }}
                onClick={() => handleOptionClick(option)}
              >
                <div style={{ fontWeight: '500', marginBottom: '4px' }}>
                  {option.title}
                </div>
                <div style={{ fontSize: '12px', color: '#666666' }}>
                  {option.description}
                </div>
              </button>
            ))}
          </div>
        </Form.FieldSet>

        {exporting && (
          <div style={{ 
            marginTop: '16px', 
            textAlign: 'center', 
            color: '#666666' 
          }}>
            {t`Exporting, please wait...`}
          </div>
        )}
      </div>

      <Dialog.Footer>
        <Dialog.Close asChild>
          <Dialog.Button disabled={exporting}>
            {t`Cancel`}
          </Dialog.Button>
        </Dialog.Close>
      </Dialog.Footer>
    </Dialog.Root>
  );
};
