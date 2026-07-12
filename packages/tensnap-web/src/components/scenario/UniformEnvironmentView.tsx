// UniformEnvironmentView.tsx
import { useState, useMemo, useCallback, useSyncExternalStore } from 'react';
import type { AgentItem as UniformAgent } from '@tensnap/protocol/layers';
import { AnchoredView } from '@/types/ui';
import { Pagination } from '@tensnap/web-common/components/ui/Pagination';
import { AgentDetailsDialog } from '../../dialogs/AgentDetailsDialog';
import { createIconElement } from '../../dialogs/AgentIconElement';
import * as styles from './UniformEnvironmentView.css';
import { Trans } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { EmptyState } from '@tensnap/web-common/components/ui/EmptyState';
import { AssetStore, Scenario, ScenarioEnvironmentState } from '@tensnap/core';
import type { AgentRef } from '@tensnap/core';
import { AgentStorage } from '@tensnap/core/environment';
import { useScenarioStore } from '@/store/scenario/store';

interface UniformEnvironmentViewProps {
  environment: ScenarioEnvironmentState;
  updateTrigger?: number;
  view?: AnchoredView;
  assets?: AssetStore;
  scenario?: Scenario;
}

const AGENTS_PER_PAGE = 12;

interface UniformAgentSource {
  layerId: string;
  storage: AgentStorage;
}

interface UniformAgentRow {
  key: string;
  agent: UniformAgent;
  ref: AgentRef;
}

const matchesAgentSearch = (agent: UniformAgent, term: string) => (
  String(agent.id).toLowerCase().includes(term)
  || agent.color?.toLowerCase().includes(term)
  || agent.icon?.toLowerCase().includes(term)
);

// Agent card component
const AgentCard = ({
  agent,
  resolveAssetUrl,
  onClick,
}: {
  agent: UniformAgent;
  resolveAssetUrl: (assetId: string) => string | undefined;
  onClick: () => void;
}) => {
  const size = agent.size || 16;
  const color = agent.color || '#666666';
  const assetId = agent.icon?.startsWith('asset:') ? agent.icon.slice('asset:'.length) : null;
  const assetUrl = assetId ? resolveAssetUrl(assetId) : undefined;

  return (
    <div className={styles.agentCard} onClick={onClick}>
      <div className={styles.agentIcon}>
        {createIconElement(agent.icon, size, color, assetUrl)}
      </div>
      <div className={styles.agentInfo}>
        <div className={styles.agentId}>#{agent.id}</div>
        <div className={styles.agentMeta}>
          {agent.icon || 'circle'} • {color}
        </div>
      </div>
    </div>
  );
};

// Empty state component
const EmptyAgentState = ({
  hasSearch,
  onClearSearch,
}: {
  hasSearch: boolean;
  onClearSearch: () => void;
}) => (
  <EmptyState
    icon="🔍"
    title={hasSearch
      ? <Trans>No agents found matching your search</Trans>
      : <Trans>No agents in this environment</Trans>}
    actions={[
      { label: <Trans>Clear search</Trans>, onClick: onClearSearch }
    ]}
  />
);

// Main component
export function UniformEnvironmentView({
  environment,
  updateTrigger,
  assets,
  scenario: scenarioOverride,
}: UniformEnvironmentViewProps) {
  const [selectedAgentRef, setSelectedAgentRef] = useState<AgentRef | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const liveScenario = useScenarioStore((store) => store.scenario);
  const scenario = scenarioOverride ?? liveScenario;
  useScenarioStore((store) => store.assetRevision);

  const sources = useMemo<UniformAgentSource[]>(() => {
    void updateTrigger;
    return [...environment.layers.values()]
      .filter((layer) => layer.storage instanceof AgentStorage)
      .map((layer) => ({ layerId: layer.id, storage: layer.storage as AgentStorage }));
  }, [environment, updateTrigger]);

  const subscribeToAgents = useCallback((onStoreChange: () => void) => {
    const unsubscribers = sources.map(({ storage }) => storage.subscribe(onStoreChange));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [sources]);
  const getAgentsRevision = useCallback(() => (
    sources.reduce((revision, { storage }) => revision + storage.revision, 0)
  ), [sources]);
  const agentsRevision = useSyncExternalStore(
    subscribeToAgents,
    getAgentsRevision,
    getAgentsRevision,
  );

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const totalAgentCount = useMemo(() => {
    void agentsRevision;
    return sources.reduce((count, { storage }) => count + storage.getData().agents.size, 0);
  }, [agentsRevision, sources]);
  const matchingAgentCount = useMemo(() => {
    void agentsRevision;
    if (!normalizedSearch) return totalAgentCount;
    let count = 0;
    for (const { storage } of sources) {
      for (const agent of storage.getData().agents.values() as Iterable<UniformAgent>) {
        if (matchesAgentSearch(agent, normalizedSearch)) count += 1;
      }
    }
    return count;
  }, [agentsRevision, normalizedSearch, sources, totalAgentCount]);

  const totalPages = Math.ceil(matchingAgentCount / AGENTS_PER_PAGE);
  const safeCurrentPage = totalPages > 0 ? Math.min(currentPage, totalPages) : 1;

  const paginatedAgents = useMemo<UniformAgentRow[]>(() => {
    void agentsRevision;
    const startIndex = (safeCurrentPage - 1) * AGENTS_PER_PAGE;
    const endIndex = startIndex + AGENTS_PER_PAGE;
    const rows: UniformAgentRow[] = [];
    let matchedIndex = 0;
    for (const { layerId, storage } of sources) {
      for (const agent of storage.getData().agents.values() as Iterable<UniformAgent>) {
        if (normalizedSearch && !matchesAgentSearch(agent, normalizedSearch)) continue;
        if (matchedIndex >= startIndex && matchedIndex < endIndex) {
          rows.push({
            key: `${layerId}:${typeof agent.id}:${agent.id}`,
            agent,
            ref: { environmentId: environment.id, layerId, agentId: agent.id },
          });
        }
        matchedIndex += 1;
        if (matchedIndex >= endIndex) return rows;
      }
    }
    return rows;
  }, [agentsRevision, environment.id, normalizedSearch, safeCurrentPage, sources]);

  const selectedAgent = useMemo(() => {
    void agentsRevision;
    if (!selectedAgentRef) return null;
    const source = sources.find(({ layerId }) => layerId === selectedAgentRef.layerId);
    return source?.storage.getData().agents.get(selectedAgentRef.agentId) as UniformAgent | undefined ?? null;
  }, [agentsRevision, selectedAgentRef, sources]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchTerm(e.target.value);
      setCurrentPage(1);
    },
    []
  );

  const handleClearSearch = useCallback(() => {
    setSearchTerm('');
  }, []);

  const handleAgentClick = useCallback((agentRef: AgentRef) => {
    setSelectedAgentRef(agentRef);
  }, []);

  const handleCloseDialog = useCallback(() => {
    setSelectedAgentRef(null);
  }, []);

  const { _ } = useLingui();
  
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.title}><Trans>Uniform Environment</Trans></div>
        <div className={styles.agentCount}>
          <Trans>{matchingAgentCount} / {totalAgentCount} agents</Trans>
        </div>
      </div>

      <input
        type="text"
        placeholder={_(msg`Search agents by ID, color, or icon...`)}
        value={searchTerm}
        onChange={handleSearchChange}
        className={styles.searchBox}
      />

      {matchingAgentCount === 0 ? (
        <EmptyAgentState
          hasSearch={!!searchTerm}
          onClearSearch={handleClearSearch}
        />
      ) : (
        <>
          <div className={styles.agentsList}>
            {paginatedAgents.map(({ key, agent, ref }) => (
              <AgentCard
                key={key}
                agent={agent}
                resolveAssetUrl={(assetId) => assets?.getUrl(assetId) ?? scenario?.assets.getUrl(assetId)}
                onClick={() => handleAgentClick(ref)}
              />
            ))}
          </div>

          <Pagination
            currentPage={safeCurrentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        </>
      )}

      <AgentDetailsDialog
        agent={selectedAgent}
        agentRef={selectedAgentRef}
        scenario={scenario}
        agentType="uniform"
        resolveAssetUrl={(assetId) => assets?.getUrl(assetId) ?? scenario?.assets.getUrl(assetId)}
        onClose={handleCloseDialog}
      />
    </div>
  );
}
