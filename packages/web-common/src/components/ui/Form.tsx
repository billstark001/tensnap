import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react';
import React, { forwardRef, useMemo } from 'react';
import * as formStyles from './Form.css';
import clsx from 'clsx';

// Form Root Component
export interface FormProps extends React.FormHTMLAttributes<HTMLFormElement> {
  children: React.ReactNode;
}

export const Form = forwardRef<HTMLFormElement, FormProps>(({ children, ...props }, ref) => {
  return (
    <form ref={ref} {...props}>
      {children}
    </form>
  );
});
Form.displayName = 'Form';

// FieldSet Component
export interface FieldSetProps extends React.FieldsetHTMLAttributes<HTMLFieldSetElement> {
  children: React.ReactNode;
}

export const FieldSet = forwardRef<HTMLFieldSetElement, FieldSetProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <fieldset ref={ref} className={`${formStyles.formFieldSet} ${className || ''}`} {...props}>
        {children}
      </fieldset>
    );
  },
);
FieldSet.displayName = 'FieldSet';

// Label Component
export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  children: React.ReactNode;
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <label ref={ref} className={`${formStyles.formLabel} ${className || ''}`} {...props}>
        {children}
      </label>
    );
  },
);
Label.displayName = 'Label';

// Input Component
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => {
  return <input ref={ref} className={`${formStyles.formInput} ${className || ''}`} {...props} />;
});
Input.displayName = 'Input';

// Textarea Component
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea ref={ref} className={`${formStyles.formInput} ${className || ''}`} {...props} />
    );
  },
);
Textarea.displayName = 'Textarea';

// Select Component
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  children: React.ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <select ref={ref} className={clsx(formStyles.formSelect, className)} {...props}>
        {children}
      </select>
    );
  },
);
Select.displayName = 'Select';

let colorContext: CanvasRenderingContext2D | null = null;
function pickerColor(value: string): string {
  if (/^#[\da-f]{6}$/i.test(value)) return value;
  if (/^#[\da-f]{3}$/i.test(value))
    return `#${[...value.slice(1)].map((digit) => digit + digit).join('')}`;
  if (typeof document === 'undefined') return '#000000';
  if (!colorContext) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    colorContext = canvas.getContext('2d', { willReadFrequently: true });
  }
  if (!colorContext) return '#000000';
  colorContext.fillStyle = '#000000';
  colorContext.fillStyle = value;
  const normalized = colorContext.fillStyle;
  if (/^#[\da-f]{6}$/i.test(normalized)) return normalized;
  // Avoid premultiplied-alpha rounding in the common rgba() case.
  const rgb = normalized.match(/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,|\))/);
  if (rgb)
    return `#${rgb
      .slice(1)
      .map((channel) => Number(channel).toString(16).padStart(2, '0'))
      .join('')}`;
  colorContext.clearRect(0, 0, 1, 1);
  colorContext.fillRect(0, 0, 1, 1);
  const [r, g, b] = colorContext.getImageData(0, 0, 1, 1).data;
  return `#${[r!, g!, b!].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export interface ColorInputProps extends Omit<InputProps, 'type' | 'value'> {
  value: string;
  pickerLabel: string;
}

/** Keep existing CSS color values editable while offering the native color picker. */
export const ColorInput = forwardRef<HTMLInputElement, ColorInputProps>(
  ({ value, pickerLabel, className, ...props }, ref) => {
    const color = useMemo(() => pickerColor(value), [value]);
    return (
      <div className={formStyles.colorField}>
        <input
          type="color"
          aria-label={pickerLabel}
          className={formStyles.colorPicker}
          value={color}
          disabled={props.disabled || props.readOnly}
          onChange={props.onChange}
        />
        <input
          {...props}
          ref={ref}
          type="text"
          value={value}
          className={clsx(formStyles.colorValue, className)}
        />
      </div>
    );
  },
);
ColorInput.displayName = 'ColorInput';

// Field Component (combines Label + Input)
export interface FieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}

export const Field: React.FC<FieldProps> = ({ label, htmlFor, children, className }) => {
  return (
    <FieldSet className={className}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </FieldSet>
  );
};

// FieldGroup Component (multi-column layout)
export interface FieldGroupProps {
  children: React.ReactNode;
  columns?: number;
  className?: string;
}

export const FieldGroup = forwardRef<HTMLDivElement, FieldGroupProps>(
  ({ children, columns = 2, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={clsx(formStyles.formFieldGroup, className)}
        style={{
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
        }}
        {...props}
      >
        {children}
      </div>
    );
  },
);
FieldGroup.displayName = 'FieldGroup';

// Export as namespace object
export default {
  Root: Form,
  FieldSet,
  Label,
  Input,
  Textarea,
  Select,
  ColorInput,
  Field,
  FieldGroup,
};
