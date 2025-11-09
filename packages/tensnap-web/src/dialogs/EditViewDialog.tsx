import React, { useState, useCallback, useEffect } from 'react';
import * as Dialog from '@/components/ui/Dialog';
import * as formStyles from '@/styles/form.css';
import { AnyView, ButtonView, AnchoredView, ContainerView } from '@/types/ui';
import { Trans } from '@lingui/react/macro';
import { useScenarioStore } from '@/store/scenario/store';
import { DialogOpenProps } from '@/utils/react';
import { PureGridEnvironment } from '@/types/model';

interface EditViewDialogProps extends DialogOpenProps {
  view: AnyView;
  onSave: (updatedView: AnyView) => void;
}

export const EditViewDialog: React.FC<EditViewDialogProps> = ({
  open,
  onOpenChange,
  view,
  onSave,
}) => {
  const [localView, setLocalView] = useState<AnyView>(view);
  const [hasChanges, setHasChanges] = useState(false);

  const environments = useScenarioStore((store) => store.environments);
  const parameters = useScenarioStore((store) => store.parameters);
  const charts = useScenarioStore((store) => store.charts);
  const updateEnvironment = useScenarioStore((store) => store.updateEnvironment);
  const updateParameterProps = useScenarioStore((store) => store.updateParameterProps);
  const updateChartProps = useScenarioStore((store) => store.updateChartProps);

  useEffect(() => {
    setLocalView(view);
    setHasChanges(false);
  }, [view, open]);

  const handleChange = useCallback((field: string, value: any) => {
    setLocalView((prev) => {
      const updated = { ...prev };
      if (field.startsWith('data.')) {
        const dataField = field.substring(5);
        updated.data = { ...prev.data, [dataField]: value };
      } else {
        (updated as any)[field] = value;
      }
      return updated;
    });
    setHasChanges(true);
  }, []);

  const handleSave = useCallback(() => {
    // Update the view in the UI
    onSave(localView);

    // For anchored views, also update the underlying data
    if (localView.type === 'environment' || localView.type === 'parameter' || localView.type === 'chart') {
      const anchoredView = localView as AnchoredView;
      const dataId = anchoredView.data.id;

      if (anchoredView.type === 'environment') {
        const env = environments?.get(dataId);
        if (env && updateEnvironment) {
          updateEnvironment(dataId, env.props);
        }
      } else if (anchoredView.type === 'parameter') {
        const param = parameters?.find(p => p.id === dataId);
        if (param && updateParameterProps) {
          updateParameterProps(dataId, {
            label: anchoredView.data.title || param.label,
          });
        }
      } else if (anchoredView.type === 'chart') {
        const chartGroup = charts?.allChartGroups.get(dataId);
        if (chartGroup && updateChartProps) {
          updateChartProps(dataId, {
            label: anchoredView.data.title || chartGroup.label,
          });
        }
      }
    }

    setHasChanges(false);
    onOpenChange?.(false);
  }, [localView, onSave, onOpenChange, environments, parameters, charts, updateEnvironment, updateParameterProps, updateChartProps]);

  const handleReset = useCallback(() => {
    setLocalView(view);
    setHasChanges(false);
  }, [view]);

  const renderViewFields = () => {
    switch (localView.type) {
      case 'button':
        return renderButtonFields(localView as ButtonView);
      case 'container':
        return renderContainerFields(localView as ContainerView);
      case 'environment':
      case 'parameter':
      case 'chart':
        return renderAnchoredFields(localView as AnchoredView);
      default:
        return null;
    }
  };

  const renderButtonFields = (buttonView: ButtonView) => (
    <>
      <fieldset className={formStyles.formFieldSet}>
        <label className={formStyles.formLabel}><Trans>Button Text</Trans></label>
        <input
          type="text"
          value={buttonView.data.text}
          onChange={(e) => handleChange('data.text', e.target.value)}
          className={formStyles.formInput}
        />
      </fieldset>
      <fieldset className={formStyles.formFieldSet}>
        <label className={formStyles.formLabel}><Trans>Disabled</Trans></label>
        <input
          type="checkbox"
          checked={buttonView.data.disabled || false}
          onChange={(e) => handleChange('data.disabled', e.target.checked)}
        />
      </fieldset>
    </>
  );

  const renderContainerFields = (containerView: ContainerView) => (
    <fieldset className={formStyles.formFieldSet}>
      <label className={formStyles.formLabel}><Trans>Title</Trans></label>
      <input
        type="text"
        value={containerView.data.title}
        onChange={(e) => handleChange('data.title', e.target.value)}
        className={formStyles.formInput}
      />
    </fieldset>
  );

  const renderAnchoredFields = (anchoredView: AnchoredView) => {
    const dataId = anchoredView.data.id;

    return (
      <>
        <fieldset className={formStyles.formFieldSet}>
          <label className={formStyles.formLabel}><Trans>Title</Trans></label>
          <input
            type="text"
            value={anchoredView.data.title || ''}
            onChange={(e) => handleChange('data.title', e.target.value)}
            className={formStyles.formInput}
          />
        </fieldset>

        {anchoredView.type === 'environment' && renderEnvironmentFields(dataId)}
        {anchoredView.type === 'parameter' && renderParameterFields(dataId)}
        {anchoredView.type === 'chart' && renderChartFields(dataId)}
      </>
    );
  };

  const renderEnvironmentFields = (envId: string) => {
    const env = environments?.get(envId);
    if (!env) return null;

    if (env.type === 'grid') {
      const gridProps = env.props as PureGridEnvironment;
      return (
        <>
          <fieldset className={formStyles.formFieldSet}>
            <label className={formStyles.formLabel}><Trans>Width</Trans></label>
            <input
              type="number"
              value={gridProps.width || 0}
              onChange={(e) => {
                const width = parseInt(e.target.value) || 0;
                if (updateEnvironment) {
                  updateEnvironment(envId, { ...gridProps, width });
                  setHasChanges(true);
                }
              }}
              className={formStyles.formInput}
            />
          </fieldset>
          <fieldset className={formStyles.formFieldSet}>
            <label className={formStyles.formLabel}><Trans>Height</Trans></label>
            <input
              type="number"
              value={gridProps.height || 0}
              onChange={(e) => {
                const height = parseInt(e.target.value) || 0;
                if (updateEnvironment) {
                  updateEnvironment(envId, { ...gridProps, height });
                  setHasChanges(true);
                }
              }}
              className={formStyles.formInput}
            />
          </fieldset>
        </>
      );
    }

    return null;
  };

  const renderParameterFields = (paramId: string) => {
    const param = parameters?.find(p => p.id === paramId);
    if (!param) return null;

    return (
      <fieldset className={formStyles.formFieldSet}>
        <label className={formStyles.formLabel}><Trans>Label</Trans></label>
        <input
          type="text"
          value={param.label}
          onChange={(e) => {
            if (updateParameterProps) {
              updateParameterProps(paramId, { label: e.target.value });
              setHasChanges(true);
            }
          }}
          className={formStyles.formInput}
        />
      </fieldset>
    );
  };

  const renderChartFields = (chartId: string) => {
    const chartGroup = charts?.allChartGroups.get(chartId);
    if (!chartGroup) return null;

    return (
      <fieldset className={formStyles.formFieldSet}>
        <label className={formStyles.formLabel}><Trans>Label</Trans></label>
        <input
          type="text"
          value={chartGroup.label}
          onChange={(e) => {
            if (updateChartProps) {
              updateChartProps(chartId, { label: e.target.value });
              setHasChanges(true);
            }
          }}
          className={formStyles.formInput}
        />
      </fieldset>
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.CloseButton />
      <Dialog.Title><Trans>Edit View</Trans></Dialog.Title>
      <Dialog.Description></Dialog.Description>

      <Dialog.Body>
        <fieldset className={formStyles.formFieldSet}>
          <label className={formStyles.formLabel}><Trans>ID</Trans></label>
          <input
            type="text"
            value={localView.id}
            disabled
            className={formStyles.formInput}
            style={{ opacity: 0.6, cursor: 'not-allowed' }}
          />
        </fieldset>

        <fieldset className={formStyles.formFieldSet}>
          <label className={formStyles.formLabel}><Trans>Type</Trans></label>
          <input
            type="text"
            value={localView.type}
            disabled
            className={formStyles.formInput}
            style={{ opacity: 0.6, cursor: 'not-allowed' }}
          />
        </fieldset>

        <fieldset className={formStyles.formFieldSet}>
          <label className={formStyles.formLabel}><Trans>Left</Trans></label>
          <input
            type="number"
            value={localView.left}
            onChange={(e) => handleChange('left', parseFloat(e.target.value) || 0)}
            className={formStyles.formInput}
          />
        </fieldset>

        <fieldset className={formStyles.formFieldSet}>
          <label className={formStyles.formLabel}><Trans>Top</Trans></label>
          <input
            type="number"
            value={localView.top}
            onChange={(e) => handleChange('top', parseFloat(e.target.value) || 0)}
            className={formStyles.formInput}
          />
        </fieldset>

        <fieldset className={formStyles.formFieldSet}>
          <label className={formStyles.formLabel}><Trans>Width</Trans></label>
          <input
            type="number"
            value={localView.width}
            onChange={(e) => handleChange('width', parseFloat(e.target.value) || 0)}
            className={formStyles.formInput}
          />
        </fieldset>

        <fieldset className={formStyles.formFieldSet}>
          <label className={formStyles.formLabel}><Trans>Height</Trans></label>
          <input
            type="number"
            value={localView.height}
            onChange={(e) => handleChange('height', parseFloat(e.target.value) || 0)}
            className={formStyles.formInput}
          />
        </fieldset>

        <fieldset className={formStyles.formFieldSet}>
          <label className={formStyles.formLabel}><Trans>Expanded</Trans></label>
          <input
            type="checkbox"
            checked={localView.expanded}
            onChange={(e) => handleChange('expanded', e.target.checked)}
          />
        </fieldset>

        <Dialog.Separator />

        {renderViewFields()}
      </Dialog.Body>

      <Dialog.Footer>
        <Dialog.Button onClick={handleReset} disabled={!hasChanges}>
          <Trans>Reset</Trans>
        </Dialog.Button>
        <Dialog.Button variant="primary" onClick={handleSave} disabled={!hasChanges}>
          <Trans>Save</Trans>
        </Dialog.Button>
        <Dialog.Close asChild>
          <Dialog.Button><Trans>Cancel</Trans></Dialog.Button>
        </Dialog.Close>
      </Dialog.Footer>
    </Dialog.Root>
  );
};
