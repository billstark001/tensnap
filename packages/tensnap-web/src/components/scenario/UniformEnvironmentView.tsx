// UniformEnvironmentView.tsx
import { useState, useMemo, useCallback, useEffect } from 'react';
import { Agent as UniformAgent } from '@/types/model';
import { Pagination } from '@/components/ui/Pagination';
import { AgentDetailsDialog, createIconElement } from '../../dialogs/AgentDetailsDialog';
import * as styles from './UniformEnvironmentView.css';
import { Trans } from '@lingui/react/macro';
import { msg } from '@lingui/macro';
import { useLingui } from '@lingui/react';
import { EmptyState } from '../ui/EmptyState';

interface UniformEnvironmentViewProps {
  environment: {
    agents: Record<string | number, UniformAgent>;
  };
}

const AGENTS_PER_PAGE = 12;

// Agent card component
const AgentCard = ({
  agent,
  onClick,
}: {
  agent: UniformAgent;
  onClick: () => void;
}) => {
  const size = agent.size || 16;
  const color = agent.color || '#666666';

  return (
    <div className={styles.agentCard} onClick={onClick}>
      <div className={styles.agentIcon}>
        {createIconElement(agent.icon, size, color)}
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
}: UniformEnvironmentViewProps) {
  const { agents } = environment;
  const [selectedAgent, setSelectedAgent] = useState<UniformAgent | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');

  const agentsList = useMemo(() => Object.values(agents), [agents]);

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

  const paginatedAgents = useMemo(() => {
    const startIndex = (currentPage - 1) * AGENTS_PER_PAGE;
    return filteredAgents.slice(startIndex, startIndex + AGENTS_PER_PAGE);
  }, [filteredAgents, currentPage]);

  // Reset to first page when filtered results change
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [currentPage, totalPages]);

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
                onClick={() => handleAgentClick(agent)}
              />
            ))}
          </div>

          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        </>
      )}

      <AgentDetailsDialog agent={selectedAgent} onClose={handleCloseDialog} />
    </div>
  );
}