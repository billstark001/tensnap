import { useCallback } from 'react';
import { BooleanParameter, EnumParameter, Parameter, ParameterType, NumberParameter, StringParameter } from '../../types/model';
import { useScenarioStore } from '../../store/scenario';
import { useWebSocketStore } from '@/store/websocket';
import { ParameterChangePayload } from '@/types/api';
import * as styles from './ParameterControl.css';
import * as Switch from '@radix-ui/react-switch';

interface ParameterControlProps {
  parameter: Parameter;
  showLabel?: boolean;
}

function SliderParameterControl({ parameter, onChange }: { parameter: NumberParameter; onChange: (value: number) => void }) {
  return (
    <div className={styles.controlContainer}>
      <input
        type="range"
        min={parameter.min || 0}
        max={parameter.max || 100}
        step={parameter.step || 1}
        value={(parameter.value as number) || 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className={styles.slider}
      />
      <span className={styles.sliderValue}>
        {parameter.value}
      </span>
    </div>
  );
}

function EnumParameterControl({ parameter, onChange }: { parameter: EnumParameter; onChange: (value: string) => void }) {
  const { value, options, labels } = parameter;
  return (
    <select
      value={(value as string) || ''}
      onChange={(e) => onChange(e.target.value)}
      className={styles.select}
    >
      <option value="">Select...</option>
      {options?.map((opt) => (
        <option key={opt} value={opt} className={styles.option}>
          {labels?.[opt] || opt}
        </option>
      ))}
    </select>
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
  action: null,
  boolean: SwitchParameterControl as any,
  string: StringParameterControl as any,
};

export function ParameterControl({ parameter, showLabel = false }: ParameterControlProps) {
  const sendMessage = useWebSocketStore((state) => state.sendMessage);
  const updateParameter = useScenarioStore((state) => state.updateParameter);

  const parameterId = parameter.id;

  const onChange = useCallback(
    (value: any) => {
      sendMessage?.<ParameterChangePayload>({
        type: 'parameter_change',
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