import { useCallback } from 'react';
import { Parameter } from '../types';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useSimulationStore } from '../store/simulation';
import * as styles from '../styles/app.css';

interface ParameterControlsProps {
  parameters: Parameter[];
}

export function ParameterControls({ parameters }: ParameterControlsProps) {
  const { sendMessage } = useWebSocket();
  const updateParameter = useSimulationStore((state) => state.updateParameter);
  
  const handleParameterChange = useCallback(
    (parameterId: string, value: any) => {
      const parameter = parameters.find((p) => p.id === parameterId);
      if (!parameter) return;
      
      if (parameter.type === 'button') {
        sendMessage({
          type: 'button_click',
          payload: { action: value },
        });
      } else {
        sendMessage({
          type: 'parameter_change',
          payload: { id: parameterId, value, setter: parameter.setter },
        });
        updateParameter(parameterId, value);
      }
    },
    [parameters, sendMessage, updateParameter]
  );
  
  return (
    <div>
      {parameters.map((param) => (
        <div key={param.id} className={styles.parameterControl}>
          <ParameterControl
            parameter={param}
            onChange={(value) => handleParameterChange(param.id, value)}
          />
        </div>
      ))}
    </div>
  );
}

interface ParameterControlProps {
  parameter: Parameter;
  onChange: (value: any) => void;
}

function ParameterControl({ parameter, onChange }: ParameterControlProps) {
  switch (parameter.type) {
    case 'slider':
      return (
        <div>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
            {parameter.label}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="range"
              min={parameter.min || 0}
              max={parameter.max || 100}
              step={parameter.step || 1}
              value={(parameter.value as number) || 0}
              onChange={(e) => onChange(Number(e.target.value))}
              className={styles.slider}
              style={{ flex: 1 }}
            />
            <span style={{ minWidth: '40px', fontSize: '14px' }}>
              {parameter.value}
            </span>
          </div>
        </div>
      );
    
    case 'enum':
      return (
        <div>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
            {parameter.label}
          </label>
          <select
            value={(parameter.value as string) || ''}
            onChange={(e) => onChange(e.target.value)}
            style={{
              width: '100%',
              padding: '6px',
              borderRadius: '4px',
              border: '1px solid #ddd',
              fontSize: '14px'
            }}
          >
            <option value="">Select...</option>
            {parameter.options?.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      );
    
    case 'button':
      return (
        <button
          onClick={() => onChange(parameter.action)}
          className={styles.button}
          style={{ width: '100%' }}
        >
          {parameter.label}
        </button>
      );
    
    default:
      return null;
  }
}