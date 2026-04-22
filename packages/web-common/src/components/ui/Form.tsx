import React, { forwardRef, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react';
import * as formStyles from './Form.css';
import clsx from 'clsx';

// Form Root Component
export interface FormProps extends React.FormHTMLAttributes<HTMLFormElement> {
  children: React.ReactNode;
}

export const Form = forwardRef<HTMLFormElement, FormProps>(
  ({ children, ...props }, ref) => {
    return (
      <form ref={ref} {...props}>
        {children}
      </form>
    );
  }
);
Form.displayName = 'Form';

// FieldSet Component
export interface FieldSetProps extends React.FieldsetHTMLAttributes<HTMLFieldSetElement> {
  children: React.ReactNode;
}

export const FieldSet = forwardRef<HTMLFieldSetElement, FieldSetProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <fieldset 
        ref={ref} 
        className={`${formStyles.formFieldSet} ${className || ''}`} 
        {...props}
      >
        {children}
      </fieldset>
    );
  }
);
FieldSet.displayName = 'FieldSet';

// Label Component
export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  children: React.ReactNode;
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <label 
        ref={ref} 
        className={`${formStyles.formLabel} ${className || ''}`} 
        {...props}
      >
        {children}
      </label>
    );
  }
);
Label.displayName = 'Label';

// Input Component
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => {
    return (
      <input 
        ref={ref} 
        className={`${formStyles.formInput} ${className || ''}`} 
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

// Textarea Component
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea 
        ref={ref} 
        className={`${formStyles.formInput} ${className || ''}`} 
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

// Select Component
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  children: React.ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <select 
        ref={ref} 
        className={`${formStyles.formInput} ${className || ''}`} 
        {...props}
      >
        {children}
      </select>
    );
  }
);
Select.displayName = 'Select';

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
  }
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
  Field,
  FieldGroup,
};
