import { useCallback, useState } from 'react';
import { BooleanParameter, EnumParameter, Parameter, ParameterType, NumberParameter, StringParameter } from '../../types/model';
import { useScenarioStore } from '../../store/scenario/store';
import { useWebSocketStore } from '@/store/websocket';
import { ParameterChangePayload } from '@/types/api';
import * as styles from './ParameterControl.css';
import * as Switch from '@radix-ui/react-switch';
import * as Select from '@/components/ui/Select';
import { useThrottled } from '@/utils';

interface ParameterControlProps {
  parameter: Parameter;
  showLabel?: boolean;
}

function SliderParameterControl({ parameter, onChange }: { parameter: NumberParameter; onChange: (value: number) => void }) {
  const [isEditingValue, setIsEditingValue] = useState(false);
  const [editValue, setEditValue] = useState(String(parameter.value));

  const throttledOnChange = useThrottled(onChange, 16);

  const handleValueClick = () => {
    setEditValue(String(parameter.value));
    setIsEditingValue(true);
  };

  const handleValueBlur = () => {
    const numValue = parseFloat(editValue);
    if (!isNaN(numValue)) {
      // Truncate to nearest valid value based on min, max, and step
      const min = parameter.min || 0;
      const max = parameter.max || 100;
      const step = parameter.step || 1;
      
      let truncated = Math.max(min, Math.min(max, numValue));
      // Round to nearest step
      truncated = Math.round((truncated - min) / step) * step + min;
      
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
        min={parameter.min || 0}
        max={parameter.max || 100}
        step={parameter.step || 1}
        value={(parameter.value as number) || 0}
        onChange={(e) => throttledOnChange(Number(e.target.value))}
        className={styles.slider}
      />
      {isEditingValue ? (
        <input
          type="number"
          value={editValue}
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
          onClick={handleValueClick}
          style={{ cursor: 'pointer' }}
          title="Click to edit"
        >
          {parameter.value}
        </span>
      )}
    </div>
  );
}

function EnumParameterControl({ parameter, onChange }: { parameter: EnumParameter; onChange: (value: string) => void }) {
  const { value, options, labels } = parameter;
  return (
    <Select.Root
      triggerClassName={styles.select}
      value={(value as string) || ''}
      onValueChange={onChange}
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

function SwitchParameterControl({ parameter, onChange }: { parameter: BooleanParameter; onChange: (value: boolean) => void }) {
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
        onCheckedChange={onChange}
      >
        <Switch.Thumb className={styles.switchThumb} />
      </Switch.Root>
    </div>
  );
}

function StringParameterControl({ parameter, onChange }: { parameter: StringParameter; onChange: (value: string) => void }) {
  return (
    <div className={styles.controlContainer}>
      <input
        type="text"
        value={parameter.value || ''}
        onChange={(e) => onChange(e.target.value)}
        className={styles.textInput}
      />
    </div>
  );
}

const FallbackRenderer: React.FC<{ parameter: Parameter }> = ({ parameter }) => {
  return <div>Unsupported parameter type: {parameter.type}</div>;
};

const renderers: Record<ParameterType, React.FC<{ parameter: Parameter; onChange: (value: any) => void }> | null> = {
  number: SliderParameterControl as any,
  enum: EnumParameterControl as any,
  boolean: SwitchParameterControl as any,
  string: StringParameterControl as any,
};

export function ParameterControl({ parameter, showLabel = false }: ParameterControlProps) {
  const sendMessage = useWebSocketStore((state) => state.sendMessage);
  const updateParameter = useScenarioStore((state) => state.updateParameterValue);
  useScenarioStore((state) => state.parameterUpdateTrigger.value);

  const parameterId = parameter.id;

  const onChange = useCallback(
    (value: any) => {
      sendMessage?.<ParameterChangePayload>({
        type: 'param_change',
        payload: { id: parameterId, value },
      });
      updateParameter?.(parameterId, value);
    },
    [parameterId, sendMessage, updateParameter]
  );

  const Renderer = renderers[parameter.type] || FallbackRenderer;

  return (
    <div className={styles.parameterContainer}>
      {showLabel && (
        <label className={styles.label}>
          {parameter.label}
        </label>
      )}
      <Renderer parameter={parameter} onChange={onChange} />
    </div>
  );


}