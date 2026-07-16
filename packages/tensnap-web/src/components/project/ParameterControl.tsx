import { useCallback, useState } from 'react';
import { BooleanParameter, EnumParameter, Parameter, ParameterType, NumberParameter, StringParameter } from '../../types/model';
import { useScenarioStore } from '../../store/scenario/store';
import { useProjectStore } from '@/store/project';
import * as styles from './ParameterControl.css';
import * as Switch from '@radix-ui/react-switch';
import * as Select from '@tensnap/web-common/components/ui/Select';
import { useThrottled } from '@tensnap/web-common/react';

interface ParameterControlProps {
  parameter: Parameter;
  showLabel?: boolean;
}

function SliderParameterControl({ parameter, onChange, disabled = false }: { parameter: NumberParameter; onChange: (value: number) => void; disabled?: boolean }) {
  const [isEditingValue, setIsEditingValue] = useState(false);
  const [editValue, setEditValue] = useState(String(parameter.value));

  const throttledOnChange = useThrottled(onChange, 16);

  const handleValueClick = () => {
    setEditValue(String(parameter.value));
    setIsEditingValue(true);
  };

  const handleValueBlur = () => {
    const numValue = Number(editValue);
    if (editValue.trim() && Number.isFinite(numValue)) {
      // Truncate to nearest valid value based on min, max, and step
      const min = parameter.min ?? 0;
      const max = parameter.max ?? 100;
      const step = parameter.step ?? 1;
      
      let truncated = Math.max(min, Math.min(max, numValue));
      // Round to nearest step
      truncated = Math.round((truncated - min) / step) * step + min;
      truncated = Math.max(min, Math.min(max, truncated));
      
      onChange(truncated);
    }
    setIsEditingValue(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleValueBlur();
    } else if (e.key === 'Escape') {
      setIsEditingValue(false);
    }
  };

  return (
    <div className={styles.controlContainer}>
      <input
        type="range"
        min={parameter.min ?? 0}
        max={parameter.max ?? 100}
        step={parameter.step ?? 1}
        value={parameter.value as number}
        disabled={disabled}
        onChange={(e) => throttledOnChange(Number(e.target.value))}
        className={styles.slider}
      />
      {isEditingValue ? (
        <input
          type="number"
          value={editValue}
          disabled={disabled}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleValueBlur}
          onKeyDown={handleKeyDown}
          autoFocus
          className={styles.sliderValueInput}
          style={{ width: '60px', textAlign: 'right' }}
        />
      ) : (
        <span 
          className={styles.sliderValue}
          onClick={disabled ? undefined : handleValueClick}
          style={{ cursor: disabled ? 'default' : 'pointer' }}
          title="Click to edit"
        >
          {parameter.value}
        </span>
      )}
    </div>
  );
}

function EnumParameterControl({ parameter, onChange, disabled = false }: { parameter: EnumParameter; onChange: (value: string) => void; disabled?: boolean }) {
  const { value, options, labels } = parameter;
  return (
    <Select.Root
      triggerClassName={styles.select}
      value={value as string}
      onValueChange={onChange}
      disabled={disabled}
    >
      {options?.length ? options.filter(Boolean).map((opt) => (
        <Select.Item key={opt} value={opt} className={styles.option} indicator>
          {labels?.[opt] || opt}
        </Select.Item>
      )) : (
        <Select.Item value="_" className={styles.option} indicator>
          (no options)
        </Select.Item>
      )}
    </Select.Root>
  );
}

function SwitchParameterControl({ parameter, onChange, disabled = false }: { parameter: BooleanParameter; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <div className={styles.controlContainer}>
      <label
        className={styles.switchLabel}
        htmlFor="airplane-mode"
      >
        {parameter.label}
      </label>
      <Switch.Root className={styles.switchRoot}
        checked={parameter.value}
        disabled={disabled}
        onCheckedChange={onChange}
      >
        <Switch.Thumb className={styles.switchThumb} />
      </Switch.Root>
    </div>
  );
}

function StringParameterControl({ parameter, onChange, disabled = false }: { parameter: StringParameter; onChange: (value: string) => void; disabled?: boolean }) {
  return (
    <div className={styles.controlContainer}>
      <input
        type="text"
        value={parameter.value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={styles.textInput}
      />
    </div>
  );
}

const FallbackRenderer: React.FC<{ parameter: Parameter; disabled?: boolean }> = ({ parameter }) => {
  return <div>Unsupported parameter type: {parameter.type}</div>;
};

const renderers: Record<ParameterType, React.FC<{ parameter: Parameter; onChange: (value: any) => void; disabled?: boolean }> | null> = {
  number: SliderParameterControl as any,
  enum: EnumParameterControl as any,
  boolean: SwitchParameterControl as any,
  string: StringParameterControl as any,
};

export function ParameterControl({ parameter, showLabel = false }: ParameterControlProps) {
  const session = useScenarioStore((state) => state.session);
  const connected = useScenarioStore((state) => state.connected);
  useScenarioStore((state) => state.parameterUpdateTrigger.value);
  const runRevision = useScenarioStore((state) => state.runRevision);
  const isSnapshotSource = useProjectStore((state) => state.activeProject?.source.kind === 'snapshot');

  const parameterId = parameter.id;
  void runRevision;
  const runtimeLocked = session?.run.status?.state === 'running' && parameter.allow_runtime_change !== true;
  const disabled = isSnapshotSource
    || !connected
    || !session
    || session.identityStatus !== 'matching'
    || runtimeLocked;

  const onChange = useCallback(
    (value: any) => {
      if (disabled || !session) {
        return;
      }
      try {
        session.setParameter(parameterId, value);
      } catch {
        // A connection can disappear between render and input dispatch. The
        // session rolls back the optimistic echo before rethrowing.
      }
    },
    [disabled, parameterId, session]
  );

  const Renderer = renderers[parameter.type] || FallbackRenderer;

  return (
    <div className={styles.parameterContainer}>
      {showLabel && (
        <label className={styles.label}>
          {parameter.label}
        </label>
      )}
      <Renderer parameter={parameter} onChange={onChange} disabled={disabled} />
    </div>
  );


}
