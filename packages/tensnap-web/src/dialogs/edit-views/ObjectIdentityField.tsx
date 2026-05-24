import React from 'react';
import { Pencil } from 'lucide-react';
import { Trans } from '@lingui/react/macro';
import Form from '@tensnap/web-common/components/ui/Form';
import * as styles from './EditViews.css';

interface ObjectIdentityFieldProps {
  label: React.ReactNode;
  value: string;
  objectExists: boolean;
  onEdit: () => void;
}

export const ObjectIdentityField: React.FC<ObjectIdentityFieldProps> = ({
  label,
  value,
  objectExists,
  onEdit,
}) => (
  <Form.Field label={label}>
    <div className={styles.inlineFieldRow}>
      <Form.Input
        type="text"
        value={value}
        disabled
        className={`${styles.disabledField} ${styles.inlineFieldGrow}`}
      />
      <button type="button" className={styles.inlineButton} onClick={onEdit}>
        <Pencil size={14} />
        <Trans>Edit ID</Trans>
      </button>
    </div>
    {!objectExists && (
      <div className={styles.warningText}>
        <Trans>No registered object is currently bound to this ID.</Trans>
      </div>
    )}
  </Form.Field>
);
