import { useEffect, useId, useState } from 'react';
import { t } from '@lingui/core/macro';
import { Dialog, Form } from '@tensnap/web-common/components/ui';
import type { DirectoryEntry, FileSystemAdapter } from '@tensnap/web-common/types/file';
import { Breadcrumbs } from './Breadcrumbs';
import { getParentPath, joinPath, validateName } from './utils';
import * as styles from './FileSystemBrowser.css';

export function FileOperationDialog({
  entry,
  operation,
  fileSystem,
  onClose,
  onComplete,
}: {
  entry: DirectoryEntry;
  operation: 'move' | 'rename';
  fileSystem: FileSystemAdapter;
  onClose(): void;
  onComplete(): Promise<void>;
}) {
  const id = useId();
  const [name, setName] = useState(entry.name);
  const [directory, setDirectory] = useState(entry.parentPath);
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(operation === 'move');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (operation !== 'move') return;
    let cancelled = false;
    void fileSystem
      .list(directory)
      .then((entries) => {
        if (!cancelled) setDirectories(entries.filter((item) => item.type === 'directory'));
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [directory, fileSystem, operation]);

  const navigate = (path: string) => {
    if (busy || path === directory) return;
    setLoading(true);
    setError(null);
    setDirectory(path);
  };

  const submit = async () => {
    if (busy || loading) return;
    const nextName = name.trim();
    if (operation === 'rename') {
      const validation = validateName(nextName);
      if (!validation.valid) {
        setError(validation.error || t`Invalid name`);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      await fileSystem.move(
        entry.path,
        operation === 'rename'
          ? joinPath(entry.parentPath, nextName)
          : joinPath(directory, entry.name),
      );
      await onComplete();
      onClose();
    } catch (err) {
      setError((err as Error).message || t`Failed to move item`);
    } finally {
      setBusy(false);
    }
  };
  const title = operation === 'rename' ? t`Rename` : t`Move`;
  return (
    <Dialog.Root
      type={operation === 'rename' ? 'RenameFileDialog' : 'MoveFileDialog'}
      title={title}
      open
      modal
      dismissible={!busy}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Description>{entry.name}</Dialog.Description>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {operation === 'rename' ? (
          <Form.FieldSet>
            <Form.Label htmlFor={id}>{t`Name`}</Form.Label>
            <Form.Input
              id={id}
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </Form.FieldSet>
        ) : (
          <>
            <Form.Label>{t`Destination directory`}</Form.Label>
            <Breadcrumbs currentDirectory={directory} onNavigate={navigate} />
            <div className={styles.moveDirectoryList}>
              {directory !== '/' && (
                <button
                  type="button"
                  className={styles.actionButton}
                  disabled={busy}
                  onClick={() => navigate(getParentPath(directory))}
                >{t`Parent directory`}</button>
              )}
              {loading ? (
                <p>{t`Loading...`}</p>
              ) : (
                directories.map((item) => (
                  <button
                    key={item.path}
                    type="button"
                    className={styles.actionButton}
                    disabled={
                      busy || item.path === entry.path || item.path.startsWith(`${entry.path}/`)
                    }
                    onClick={() => navigate(item.path)}
                  >
                    📁 {item.name}
                  </button>
                ))
              )}
            </div>
          </>
        )}
        {error && (
          <p role="alert" className={styles.operationError}>
            {error}
          </p>
        )}
        <Dialog.Footer>
          <Dialog.Button disabled={busy} onClick={onClose}>{t`Cancel`}</Dialog.Button>
          <Dialog.Button
            type="submit"
            variant="primary"
            disabled={
              busy ||
              loading ||
              (operation === 'rename'
                ? !name.trim() || name.trim() === entry.name
                : directory === entry.parentPath)
            }
          >
            {title}
          </Dialog.Button>
        </Dialog.Footer>
      </form>
    </Dialog.Root>
  );
}
