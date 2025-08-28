import { useCallback } from 'react';
import { Parameter } from '../types/modeling';
import { useScenarioStore } from '../store/scenario';
import { useWebSocketStore } from '@/store/websocket';
import { ParameterChangePayload } from '@/types/api';
import * as styles from './ParameterControl.css';

interface ParameterControlProps {
  parameter: Parameter;
  showLabel?: boolean;
}

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
  

  switch (parameter.type) {
    case 'slider':
      return (
        <div className={styles.parameterContainer}>
          {showLabel && (
            <label className={styles.label}>
              {parameter.label}
            </label>
          )}
          <div className={styles.sliderContainer}>
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
        </div>
      );

    case 'enum':
      return (
        <div className={styles.parameterContainer}>
          {showLabel && (
            <label className={styles.label}>
              {parameter.label}
            </label>
          )}
          <select
            value={(parameter.value as string) || ''}
            onChange={(e) => onChange(e.target.value)}
            className={styles.select}
          >
            <option value="">Select...</option>
            {parameter.options?.map((opt) => (
              <option key={opt} value={opt} className={styles.option}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      );

    default:
      return null;
  }
}