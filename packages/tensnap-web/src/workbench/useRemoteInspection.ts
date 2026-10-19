import { t } from '@lingui/core/macro';
import { useEffect, useState, useRef } from 'react';
import { Scenario, type LiveAgentInspection } from '@tensnap/core';
import type { AssetSnapshot } from '@tensnap/core/asset';
import type { AgentInspectionSource } from './agent-inspection-source';
import { useCallbackRef } from '@tensnap/web-common/react';
import { useToast } from '../store/toast';

export function useRemoteInspection(
  source: AgentInspectionSource | undefined,
  radius: number,
  open: boolean,
  onClose: () => void,
) {
  const [scenario] = useState(() => new Scenario());
  const [inspection, setInspection] = useState<LiveAgentInspection>();
  const token = useRef<string | undefined>(undefined);
  const assets = useRef(new Map<string, AssetSnapshot>());
  const close = useCallbackRef(onClose);
  const toast = useToast();
  useEffect(() => {
    token.current = undefined;
    assets.current.clear();
    return () => {
      scenario.reset({ preserveTrajectoryLayers: false });
    };
  }, [source, scenario]);
  useEffect(() => {
    if (!source || !open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const read = async () => {
      try {
        const response = await source.read(
          {
            radius,
            token: token.current,
            assets: scenario.assets.getHeldHashes(),
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        failures = 0;
        if ('view' in response) {
          token.current = response.token;
          if (!response.view) {
            close();
            return;
          }
          for (const [id, asset] of assets.current)
            if (response.view.assetHashes[id] !== asset.meta.hash) assets.current.delete(id);
          response.view.scene.assets.forEach((asset) => assets.current.set(asset.meta.id, asset));
          scenario.load({ ...response.view.scene, assets: [...assets.current.values()] });
          setInspection(response.view.inspection);
        }
        // Schedule after completion: slow IPC can never accumulate a queue.
        timer = setTimeout(() => {
          void read();
        }, 100);
      } catch (error) {
        if (controller.signal.aborted) return;
        failures++;
        if (failures >= 5) {
          toast.error(t`Agent inspection failed`, String(error));
          close();
          return;
        }
        // One bounded backoff timer, cancelled on retarget, radius change and closure.
        timer = setTimeout(
          () => {
            void read();
          },
          Math.min(250 * 2 ** (failures - 1), 4000),
        );
      }
    };
    void read();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [source, open, radius, scenario, toast, close]);
  return { scenario, inspection };
}
