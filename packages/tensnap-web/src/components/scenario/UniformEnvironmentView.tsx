// UniformEnvironmentView.tsx
import { useState, useMemo, useCallback, useEffect } from 'react';
import { Agent as UniformAgent } from '@/types/model';
import { AnchoredView } from '@/types/ui';
import { Pagination } from '@tensnap/web-common/components/ui/Pagination';
import { AgentDetailsDialog } from '../../dialogs/AgentDetailsDialog';
import { createIconElement } from '../../dialogs/AgentIconElement';
import * as styles from './UniformEnvironmentView.css';
import { Trans } from '@lingui/react/macro';
import { msg } from '@lingui/macro';
import { useLingui } from '@lingui/react';
import { EmptyState } from '@tensnap/web-common/components/ui/EmptyState';
import { ScenarioEnvironmentState } from '@tensnap/core';
import { AgentStorage } from '@tensnap/core/environment';
import { useScenarioStore } from '@/store/scenario/store';

interface UniformEnvironmentViewProps {
  environment: ScenarioEnvironmentState;
  updateTrigger?: number;
  view?: AnchoredView;
}

const AGENTS_PER_PAGE = 12;

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
}: UniformEnvironmentViewProps) {
  const [selectedAgent, setSelectedAgent] = useState<UniformAgent | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [agentsList, setAgentsList] = useState<UniformAgent[]>([]);
  const scenario = useScenarioStore((store) => store.scenario);
  useScenarioStore((store) => store._assetRevision);

  useEffect(() => {
    const storages = [...environment.layers.values()]
      .filter((layer) => layer.storage instanceof AgentStorage)
      .map((layer) => layer.storage as AgentStorage);

    const collectAgents = () => {
      const merged: UniformAgent[] = [];
      for (const storage of storages) {
        merged.push(...Array.from(storage.getData().agents.values()) as UniformAgent[]);
      }
      setAgentsList(merged);
    };

    collectAgents();
    const unsubscribers = storages.map((storage) => storage.subscribe(() => collectAgents()));

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [environment, updateTrigger]);

  const filteredAgents = useMemo(() => {
    if (!searchTerm.trim()) return agentsList;

    const term = searchTerm.toLowerCase();
    return agentsList.filter(
      (agent) =>
        agent.id.toString().toLowerCase().includes(term) ||
        agent.color?.toLowerCase().includes(term) ||
        agent.icon?.toLowerCase().includes(term)
    );
  }, [agentsList, searchTerm]);

  const totalPages = Math.ceil(filteredAgents.length / AGENTS_PER_PAGE);
  const safeCurrentPage = totalPages > 0 ? Math.min(currentPage, totalPages) : 1;

  const paginatedAgents = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * AGENTS_PER_PAGE;
    return filteredAgents.slice(startIndex, startIndex + AGENTS_PER_PAGE);
  }, [filteredAgents, safeCurrentPage]);

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

  const handleAgentClick = useCallback((agent: UniformAgent) => {
    setSelectedAgent(agent);
  }, []);

  const handleCloseDialog = useCallback(() => {
    setSelectedAgent(null);
  }, []);

  const { _ } = useLingui();
  
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.title}><Trans>Uniform Environment</Trans></div>
        <div className={styles.agentCount}>
          <Trans>{filteredAgents.length} / {agentsList.length} agents</Trans>
        </div>
      </div>

      <input
        type="text"
        placeholder={_(msg`Search agents by ID, color, or icon...`)}
        value={searchTerm}
        onChange={handleSearchChange}
        className={styles.searchBox}
      />

      {filteredAgents.length === 0 ? (
        <EmptyAgentState
          hasSearch={!!searchTerm}
          onClearSearch={handleClearSearch}
        />
      ) : (
        <>
          <div className={styles.agentsList}>
            {paginatedAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                resolveAssetUrl={(assetId) => scenario?.assets.getUrl(assetId)}
                onClick={() => handleAgentClick(agent)}
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
        resolveAssetUrl={(assetId) => scenario?.assets.getUrl(assetId)}
        onClose={handleCloseDialog}
      />
    </div>
  );
}