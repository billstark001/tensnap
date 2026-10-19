import { createElement, type ReactNode } from 'react';
import { I18nProvider } from '@lingui/react';
import { WindowTypeContext } from '@tensnap/web-common/workbench/dialog-content';
import { AgentDetailsDialogContent } from '../dialogs/AgentDetailsDialog';
import { SimulatorInfoDialogContent } from '../dialogs/SimulatorInfoDialog';
import type { AgentInspectionSource } from './agent-inspection-source';
import {
  AuxiliaryStateSchema,
  parseInspectionResponse,
  type AuxiliaryState,
  type AuxiliaryRpc,
} from './auxiliary-protocol';
import { i18n, initI18n } from '../i18n';
import { ToastAnchor } from '../store/toast';

let localeActivation: Promise<unknown> = Promise.resolve();

/** Receiver owns only its React UI and the inspector's small disposable rendering scene. */
export function mountAuxiliaryWindow(
  initial: AuxiliaryState,
  rpc: AuxiliaryRpc,
  render: (node: ReactNode) => void,
) {
  let disposed = false;
  let latest: AuxiliaryState | undefined;
  let acceptedRevision = -1;
  let locale: string | undefined;
  let synchronizing = false;
  let targetKey: string | undefined;
  let source: AgentInspectionSource | undefined;
  const close = () => {
    if (!disposed) rpc.close();
  };
  const publish = (state: AuxiliaryState) => {
    const content = state.content;
    let node: ReactNode;
    if (content.id === 'AgentDetailsDialog') {
      const key = JSON.stringify(content.target);
      if (key !== targetKey) {
        targetKey = key;
        source = {
          read: async (request, signal) =>
            parseInspectionResponse(await rpc.request({ method: 'inspect', request }, signal)),
        };
      }
      node = createElement(AgentDetailsDialogContent, {
        open: true,
        onClose: close,
        agent: null,
        agentRef: content.target,
        agentType: content.agentType,
        inspectionSource: source,
      });
    } else
      node = createElement(SimulatorInfoDialogContent, {
        open: true,
        onOpenChange: (open) => {
          if (!open) close();
        },
        simulatorInfo: content.simulatorInfo,
        metadata: content.metadata,
      });
    render(
      createElement(
        I18nProvider,
        { i18n },
        createElement(WindowTypeContext.Provider, { value: content.id }, node),
        createElement(ToastAnchor),
      ),
    );
  };
  // Serialize locale activation; a slow old catalog cannot overwrite a newer locale.
  const synchronize = async () => {
    if (synchronizing) return;
    synchronizing = true;
    try {
      while (!disposed && latest) {
        const state = latest;
        if (locale !== state.appearance.locale) {
          localeActivation = localeActivation
            .catch(() => {})
            .then(() => (disposed ? undefined : initI18n(state.appearance.locale)));
          await localeActivation;
          locale = state.appearance.locale;
        }
        if (disposed) return;
        if (state !== latest) continue;
        document.body.dataset.theme = state.appearance.theme;
        publish(state);
        return;
      }
    } finally {
      synchronizing = false;
    }
  };
  const update = (input: AuxiliaryState) => {
    if (disposed) return;
    const state = AuxiliaryStateSchema.parse(input);
    if (state.content.id !== initial.content.id || state.projectId !== initial.projectId)
      throw new Error('Auxiliary window ownership cannot change.');
    if (state.revision <= acceptedRevision) return;
    acceptedRevision = state.revision;
    latest = state;
    void synchronize().catch((error) => {
      if (!disposed) {
        console.error('Auxiliary window initialization failed:', error);
        close();
      }
    });
  };
  update(initial);
  return {
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      latest = undefined;
      source = undefined;
      render(null);
    },
  };
}
