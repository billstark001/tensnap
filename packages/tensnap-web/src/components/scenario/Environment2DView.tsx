import { useRef, useEffect, useContext, useState } from 'react';
import type { AnchoredView } from '@tensnap/core/persistence';
import * as styles from './Environment2DView.css';
import { AgentDetailsDialog } from '../../dialogs/AgentDetailsDialog';
import { EnvironmentViewportContext } from './EnvironmentViewportContext';
import { useScenarioStore } from '@/store/scenario/store';
import { useToast } from '@/store/toast';
import type { AgentRef } from '@tensnap/core';
import type { AgentRenderState } from '@tensnap/core/environment';
import type { ScenarioEnvironmentState } from '@tensnap/core/scenario';
import type { AssetStore, Scenario } from '@tensnap/core';
import { EnvironmentRendererController } from '@tensnap/core/scenario/browser';

interface Environment2DViewProps {
  environment: ScenarioEnvironmentState;
  updateTrigger?: number;
  view?: AnchoredView;
  assets?: AssetStore;
  scenario?: Scenario;
}

export function Environment2DView({
  environment,
  updateTrigger,
  view,
  assets,
  scenario: scenarioOverride,
}: Environment2DViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<EnvironmentRendererController | null>(null);
  const registerReset = useContext(EnvironmentViewportContext);

  const [selectedAgent, setSelectedAgent] = useState<{
    agent: AgentRenderState;
    ref: AgentRef;
  } | null>(null);
  const liveScenario = useScenarioStore((store) => store.scenario);
  const scenario = scenarioOverride ?? liveScenario;
  const toast = useToast();
  const scenarioRef = useRef(scenario);
  const environmentIdRef = useRef(environment.id);
  const toastErrorRef = useRef(toast.error);

  useEffect(() => {
    scenarioRef.current = scenario;
  }, [scenario]);

  useEffect(() => {
    environmentIdRef.current = environment.id;
  }, [environment.id]);

  useEffect(() => {
    toastErrorRef.current = toast.error;
  }, [toast.error]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const controller = new EnvironmentRendererController(containerRef.current, {
      resolveAssetUrl: (assetId) =>
        assets?.getUrl(assetId) ?? scenarioRef.current?.assets.getUrl(assetId),
      onAgentSelect: (agent, layerId) =>
        setSelectedAgent({
          agent,
          ref: {
            environmentId: environmentIdRef.current,
            layerId: layerId ?? '',
            agentId: agent.id,
          },
        }),
      onRenderError: (title, detail) => toastErrorRef.current(title, detail),
    });
    controllerRef.current = controller;
    const unregisterReset = registerReset?.(() => controller.resetView());

    return () => {
      controller.destroy();
      unregisterReset?.();
      controllerRef.current = null;
    };
  }, [assets, registerReset]);

  useEffect(() => {
    controllerRef.current?.render(environment, view?.data.layerOverrides);
  }, [environment, updateTrigger, view?.data.layerOverrides]);

  return (
    <div className={styles.container}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <AgentDetailsDialog
        agentType="2d"
        agent={selectedAgent?.agent ?? null}
        agentRef={selectedAgent?.ref ?? null}
        scenario={scenario}
        resolveAssetUrl={(assetId) => scenarioRef.current?.assets.getUrl(assetId)}
        onClose={() => setSelectedAgent(null)}
      />
    </div>
  );
}
