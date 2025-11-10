import React, { useState } from 'react';
import { Trans } from '@lingui/react/macro';
import Form from '@/components/ui/Form';
import { AnchoredView } from '@/types/ui';
import { BaseViewFields, BaseViewEditorProps } from './BaseViewEditor';
import { Parameter } from '@/types/model';
import * as styles from './EditViews.css';
import * as Select from '@/components/ui/Select';
import { Plus, Trash2, Edit2 } from 'lucide-react';

interface ParameterViewEditorProps extends BaseViewEditorProps {
  view: AnchoredView;
  objectData: Parameter | null;
  onObjectChange: (field: string, value: any) => void;
}

// Helper function
const parseNumberInput = (value: string, fallback: number = 0): number => {
  if (value === '' || value === '-') return fallback;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? fallback : parsed;
};

// TypeSelector Component
const TypeSelector: React.FC<{
  value: string;
  onChange: (value: string) => void;
}> = ({ value, onChange }) => (
  <Form.Field label={<Trans>Parameter Type</Trans>} htmlFor="param-type">
    <Select.Root value={value} onValueChange={onChange} triggerClassName={styles.selectTrigger}>
      <Select.Viewport>
        <Select.Item value="number" indicator>Number</Select.Item>
        <Select.Item value="enum" indicator>Enum</Select.Item>
        <Select.Item value="boolean" indicator>Boolean</Select.Item>
        <Select.Item value="string" indicator>String</Select.Item>
      </Select.Viewport>
    </Select.Root>
  </Form.Field>
);

// NumberParameterFields Component
const NumberParameterFields: React.FC<{
  param: any;
  onObjectChange: (field: string, value: any) => void;
}> = ({ param, onObjectChange }) => (
  <Form.FieldGroup columns={3}>
    <Form.Field label={<Trans>Minimum Value</Trans>} htmlFor="param-min">
      <Form.Input
        id="param-min"
        type="number"
        value={param.min ?? ''}
        onChange={(e) => onObjectChange('min', parseNumberInput(e.target.value, param.min ?? 0))}
      />
    </Form.Field>
    <Form.Field label={<Trans>Maximum Value</Trans>} htmlFor="param-max">
      <Form.Input
        id="param-max"
        type="number"
        value={param.max ?? ''}
        onChange={(e) => onObjectChange('max', parseNumberInput(e.target.value, param.max ?? 100))}
      />
    </Form.Field>
    <Form.Field label={<Trans>Step</Trans>} htmlFor="param-step">
      <Form.Input
        id="param-step"
        type="number"
        value={param.step ?? ''}
        onChange={(e) => onObjectChange('step', parseNumberInput(e.target.value, param.step ?? 1))}
      />
    </Form.Field>
  </Form.FieldGroup>
);

// EnumOptionEditor Component
const EnumOptionEditor: React.FC<{
  option: string;
  label: string;
  onUpdate: (value: string, label: string) => void;
  onCancel: () => void;
}> = ({ option, label, onUpdate, onCancel }) => {
  const [value, setValue] = useState(option);
  const [displayLabel, setDisplayLabel] = useState(label);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Escape') onCancel();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <Form.Input
        type="text"
        placeholder="Value"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onUpdate(e.target.value, displayLabel);
        }}
        onBlur={onCancel}
        onKeyDown={handleKeyDown}
        style={{ padding: '2px 4px', fontSize: '0.875rem' }}
      />
      <Form.Input
        type="text"
        placeholder="Label (optional)"
        value={displayLabel}
        onChange={(e) => {
          setDisplayLabel(e.target.value);
          onUpdate(value, e.target.value);
        }}
        onBlur={onCancel}
        onKeyDown={handleKeyDown}
        autoFocus
        style={{ padding: '2px 4px', fontSize: '0.875rem' }}
      />
    </div>
  );
};

// EnumOptionItem Component
const EnumOptionItem: React.FC<{
  option: string;
  label: string;
  isEditing: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onUpdate: (value: string, label: string) => void;
}> = ({ option, label, isEditing, onEdit, onRemove, onUpdate }) => (
  <div className={styles.seriesItem}>
    <div style={{ flex: 1, minWidth: 0 }}>
      {isEditing ? (
        <EnumOptionEditor
          option={option}
          label={label}
          onUpdate={onUpdate}
          onCancel={onEdit}
        />
      ) : (
        <span className={styles.seriesLabel}>
          {label || option}
          {label && <span className={styles.seriesId}> ({option})</span>}
        </span>
      )}
    </div>
    <button type="button" onClick={onEdit} className={styles.iconButton} title="Edit">
      <Edit2 size={14} />
    </button>
    <button type="button" onClick={onRemove} className={styles.iconButton} title="Remove">
      <Trash2 size={14} />
    </button>
  </div>
);

// NewOptionForm Component
const NewOptionForm: React.FC<{
  value: string;
  label: string;
  onChange: (value: string, label: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ value, label, onChange, onConfirm, onCancel }) => (
  <div className={styles.seriesItem} style={{ border: '1px dashed #ccc', padding: '8px', marginBottom: '8px' }}>
    <Form.Input
      type="text"
      placeholder="Option Value"
      value={value}
      onChange={(e) => onChange(e.target.value, label)}
      style={{ flex: 1 }}
    />
    <Form.Input
      type="text"
      placeholder="Display Label (optional)"
      value={label}
      onChange={(e) => onChange(value, e.target.value)}
      style={{ flex: 1 }}
    />
    <button type="button" onClick={onConfirm} className={styles.iconButton} title="Confirm">
      <Plus size={16} />
    </button>
    <button type="button" onClick={onCancel} className={styles.iconButton} title="Cancel">
      <Trash2 size={16} />
    </button>
  </div>
);

// EnumParameterFields Component
const EnumParameterFields: React.FC<{
  param: any;
  onObjectChange: (field: string, value: any) => void;
}> = ({ param, onObjectChange }) => {
  const [editingOptionIndex, setEditingOptionIndex] = useState<number | null>(null);
  const [newOptionForm, setNewOptionForm] = useState<{ value: string; label: string } | null>(null);

  const options = param.options || [];
  const labels = param.labels || {};

  const handleAddOption = () => {
    if (!newOptionForm) {
      setNewOptionForm({ value: '', label: '' });
    } else if (newOptionForm.value) {
      onObjectChange('options', [...options, newOptionForm.value]);
      if (newOptionForm.label) {
        onObjectChange('labels', { ...labels, [newOptionForm.value]: newOptionForm.label });
      }
      setNewOptionForm(null);
    }
  };

  const handleRemoveOption = (index: number) => {
    const optionValue = options[index];
    onObjectChange('options', options.filter((_: string, i: number) => i !== index));
    if (labels[optionValue]) {
      const newLabels = { ...labels };
      delete newLabels[optionValue];
      onObjectChange('labels', newLabels);
    }
  };

  const handleUpdateOption = (index: number, newValue: string, newLabel?: string) => {
    const oldValue = options[index];
    const newOptions = [...options];
    newOptions[index] = newValue;
    onObjectChange('options', newOptions);

    if (oldValue !== newValue || newLabel !== undefined) {
      const newLabels = { ...labels };
      if (oldValue !== newValue && newLabels[oldValue]) {
        delete newLabels[oldValue];
      }
      if (newLabel) {
        newLabels[newValue] = newLabel;
      }
      onObjectChange('labels', newLabels);
    }
  };

  return (
    <Form.FieldSet>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <Form.Label>
          <Trans>Enum Options</Trans> ({options.length})
        </Form.Label>
        <button type="button" onClick={handleAddOption} className={styles.iconButton} title="Add option">
          <Plus size={16} />
        </button>
      </div>

      {newOptionForm && (
        <NewOptionForm
          value={newOptionForm.value}
          label={newOptionForm.label}
          onChange={(value, label) => setNewOptionForm({ value, label })}
          onConfirm={handleAddOption}
          onCancel={() => setNewOptionForm(null)}
        />
      )}

      {options.length > 0 ? (
        <div className={styles.seriesList}>
          {options.map((option: string, index: number) => (
            <EnumOptionItem
              key={index}
              option={option}
              label={labels[option] || ''}
              isEditing={editingOptionIndex === index}
              onEdit={() => setEditingOptionIndex(editingOptionIndex === index ? null : index)}
              onRemove={() => handleRemoveOption(index)}
              onUpdate={(newValue, newLabel) => handleUpdateOption(index, newValue, newLabel)}
            />
          ))}
        </div>
      ) : (
        <div className={styles.infoText}>
          <Trans>(No options available)</Trans>
        </div>
      )}
    </Form.FieldSet>
  );
};

// Main Component
export const ParameterViewEditor: React.FC<ParameterViewEditorProps> = ({
  view,
  objectData: param,
  onChange,
  onObjectChange,
}) => {
  if (!param) return <BaseViewFields view={view} onChange={onChange} />;

  return (
    <>
      <BaseViewFields view={view} onChange={onChange} />

      <Form.Field label={<Trans>Title</Trans>} htmlFor="param-title">
        <Form.Input
          id="param-title"
          type="text"
          value={view.data.title || ''}
          onChange={(e) => onChange('data.title', e.target.value)}
        />
      </Form.Field>

      <Form.FieldGroup columns={2}>
        <Form.Field label={<Trans>Parameter ID</Trans>} htmlFor="param-id">
          <Form.Input
            id="param-id"
            type="text"
            value={param.id}
            onChange={(e) => onObjectChange('id', e.target.value)}
          />
        </Form.Field>

        <TypeSelector value={param.type} onChange={(value) => onObjectChange('type', value)} />
      </Form.FieldGroup>

      <Form.Field label={<Trans>Parameter Label</Trans>} htmlFor="param-label">
        <Form.Input
          id="param-label"
          type="text"
          value={param.label}
          onChange={(e) => onObjectChange('label', e.target.value)}
        />
      </Form.Field>

      {param.type === 'number' && <NumberParameterFields param={param} onObjectChange={onObjectChange} />}
      {param.type === 'enum' && <EnumParameterFields param={param} onObjectChange={onObjectChange} />}

      <Form.FieldSet>
        <Form.Label htmlFor="param-runtime-change" className={styles.checkboxLabel}>
          <input
            id="param-runtime-change"
            type="checkbox"
            checked={param.allowRuntimeChange || false}
            onChange={(e) => onObjectChange('allowRuntimeChange', e.target.checked)}
            className={styles.checkboxInput}
          />
          <Trans>Allow Runtime Change</Trans>
        </Form.Label>
      </Form.FieldSet>
    </>
  );
};