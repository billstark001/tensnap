/**
 * FakeModelPickerProvider
 * 
 * Provider for selecting and loading fake simulation models.
 * Similar to FilePickerProvider but for built-in fake models.
 */

import React, { createContext, useContext, useCallback, useState, ReactNode } from 'react';
import * as Dialog from 'tensnap-web/components/ui/Dialog';
import { FAKE_MODELS, FakeModelMetadata } from './index';

export interface FakeModelPickerResult {
  model: FakeModelMetadata | null;
  cancelled: boolean;
}

interface FakeModelPickerContextValue {
  pickModel: () => Promise<FakeModelPickerResult>;
}

const FakeModelPickerContext = createContext<FakeModelPickerContextValue | null>(null);

export const useFakeModelPicker = (): FakeModelPickerContextValue => {
  const context = useContext(FakeModelPickerContext);
  if (!context) {
    throw new Error('useFakeModelPicker must be used within a FakeModelPickerProvider');
  }
  return context;
};

interface FakeModelPickerProviderProps {
  children: ReactNode;
}

interface PickerState {
  isOpen: boolean;
  resolve: ((result: FakeModelPickerResult) => void) | null;
}

const FakeModelCard: React.FC<{
  model: FakeModelMetadata;
  onSelect: (model: FakeModelMetadata) => void;
}> = ({ model, onSelect }) => (
  <div
    onClick={() => onSelect(model)}
    style={{
      border: '1px solid var(--color-border)',
      borderRadius: '8px',
      padding: '16px',
      cursor: 'pointer',
      transition: 'all 0.2s',
      backgroundColor: 'var(--color-background)',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.backgroundColor = 'var(--color-hover)';
      e.currentTarget.style.borderColor = 'var(--color-primary)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.backgroundColor = 'var(--color-background)';
      e.currentTarget.style.borderColor = 'var(--color-border)';
    }}
  >
    <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: '600' }}>
      {model.name}
    </h3>
    <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)', lineHeight: '1.5' }}>
      {model.description}
    </p>
  </div>
);

export const FakeModelPickerProvider: React.FC<FakeModelPickerProviderProps> = ({ children }) => {
  const [pickerState, setPickerState] = useState<PickerState>({
    isOpen: false,
    resolve: null,
  });

  const openPicker = useCallback((): Promise<FakeModelPickerResult> => {
    return new Promise((resolve) => {
      setPickerState({
        isOpen: true,
        resolve,
      });
    });
  }, []);

  const closePicker = useCallback((result: FakeModelPickerResult) => {
    if (pickerState.resolve) {
      pickerState.resolve(result);
    }
    setPickerState({
      isOpen: false,
      resolve: null,
    });
  }, [pickerState.resolve]);

  const handleCancel = useCallback(() => {
    closePicker({
      model: null,
      cancelled: true,
    });
  }, [closePicker]);

  const handleModelSelect = useCallback((model: FakeModelMetadata) => {
    closePicker({
      model,
      cancelled: false,
    });
  }, [closePicker]);

  const pickModel = useCallback((): Promise<FakeModelPickerResult> => {
    return openPicker();
  }, [openPicker]);

  const contextValue: FakeModelPickerContextValue = {
    pickModel,
  };

  return (
    <FakeModelPickerContext.Provider value={contextValue}>
      {children}

      {/* Model picker dialog */}
      <Dialog.Root open={pickerState.isOpen} onOpenChange={(open) => !open && handleCancel()} size='lg'>
        <Dialog.Title>
          Select Fake Model
        </Dialog.Title>
        <Dialog.Description style={{ marginTop: '8px', color: 'var(--color-text-secondary)' }}>
          Choose a built-in simulation model to run in your browser.
        </Dialog.Description>

        <Dialog.Body>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '16px',
              padding: '8px',
            }}
          >
            {FAKE_MODELS.map((model) => (
              <FakeModelCard
                key={model.id}
                model={model}
                onSelect={handleModelSelect}
              />
            ))}
          </div>

          {FAKE_MODELS.length === 0 && (
            <div
              style={{
                padding: '48px',
                textAlign: 'center',
                color: 'var(--color-text-secondary)',
              }}
            >
              <p>No fake models available.</p>
            </div>
          )}
        </Dialog.Body>

        <Dialog.Footer>
          <Dialog.Close asChild>
            <Dialog.Button onClick={handleCancel}>
              Cancel
            </Dialog.Button>
          </Dialog.Close>
        </Dialog.Footer>

        <Dialog.CloseButton />
      </Dialog.Root>
    </FakeModelPickerContext.Provider>
  );
};
