import numpy as np
import networkx as nx
import random
from typing import List, Any, Dict


class DiscreteHKModel:
    def __init__(
        self,
        n_agents: int,
        confidence_bound: float = 0.3,
        influence_strength: float = 0.1,
        k_random: int = 3,
        rewire_prob: float = 0.1,
        initial_opinions: List[float] | None = None,
        edge_prob: float = 0.1,
    ):
        """
        离散Hegselmann-Krause模型

        参数:
        n_agents: 主体数量
        confidence_bound: 置信区间，超过此差值的意见被认为差别过大
        influence_strength: 意见影响强度参数
        k_random: 每次迭代随机选择的影响主体数量
        rewire_prob: 重连概率q
        initial_opinions: 初始意见分布
        edge_prob: 初始图的边概率
        """
        self.n_agents = n_agents
        self.confidence_bound = confidence_bound
        self.influence_strength = influence_strength
        self.k_random = k_random
        self.rewire_prob = rewire_prob
        self.edge_prob = edge_prob
        self.initial_opinions = initial_opinions
        self.graph: nx.DiGraph = nx.DiGraph()
        self.opinions: np.ndarray = np.zeros(n_agents)
        self.opinion_history: List[np.ndarray] = []

        self.init()

    def init(self):
        # 初始化意见
        if self.initial_opinions is None:
            self.opinions = np.random.uniform(-1, 1, self.n_agents)
        else:
            self.opinions = np.array(self.initial_opinions)

        # 创建有向E-R图
        self.graph = nx.erdos_renyi_graph(self.n_agents, self.edge_prob, directed=True)

        # 记录历史
        self.opinion_history = [self.opinions.copy()]

    def get_neighbors(self, agent_id: int) -> List[int]:
        """获取指向某个主体的邻居"""
        return list(self.graph.predecessors(agent_id))

    def get_out_neighbors(self, agent_id: int) -> List[int]:
        """获取某个主体指向的邻居"""
        return list(self.graph.successors(agent_id))

    def calculate_opinion_influence(self, agent_id: int) -> float:
        """计算对主体的意见影响"""
        current_opinion = self.opinions[agent_id]
        total_influence = 0.0
        influence_count = 0

        # 来自有向边的影响
        neighbors = self.get_neighbors(agent_id)
        for neighbor in neighbors:
            neighbor_opinion = self.opinions[neighbor]
            if abs(current_opinion - neighbor_opinion) <= self.confidence_bound:
                total_influence += neighbor_opinion
                influence_count += 1

        # 随机k个主体的影响
        all_agents = list(range(self.n_agents))
        all_agents.remove(agent_id)  # 移除自己

        k_random_agents = random.sample(all_agents, min(self.k_random, len(all_agents)))
        for random_agent in k_random_agents:
            random_opinion = self.opinions[random_agent]
            if abs(current_opinion - random_opinion) <= self.confidence_bound:
                total_influence += random_opinion
                influence_count += 1

        if influence_count > 0:
            average_influence = total_influence / influence_count
            # 使用影响强度参数调节意见变化
            new_opinion = current_opinion + self.influence_strength * (
                average_influence - current_opinion
            )
            return np.clip(new_opinion, -1, 1)
        else:
            return current_opinion

    def find_incompatible_connections(self, agent_id: int) -> List[int]:
        """找到与主体意见差别过大的连接"""
        current_opinion = self.opinions[agent_id]
        out_neighbors = self.get_out_neighbors(agent_id)
        incompatible = []

        for neighbor in out_neighbors:
            if abs(current_opinion - self.opinions[neighbor]) > self.confidence_bound:
                incompatible.append(neighbor)

        return incompatible

    def find_compatible_agent(self, agent_id: int) -> int | None:
        """找到一个意见范围内的主体进行连接"""
        current_opinion = self.opinions[agent_id]
        compatible_agents = []

        for other_agent in range(self.n_agents):
            if (
                other_agent != agent_id
                and abs(current_opinion - self.opinions[other_agent])
                <= self.confidence_bound
                and not self.graph.has_edge(agent_id, other_agent)
            ):
                compatible_agents.append(other_agent)

        if compatible_agents:
            return random.choice(compatible_agents)
        return None

    def rewire_connections(self) -> Dict[str, int]:
        """重新连接网络"""
        rewire_stats = {"disconnections": 0, "new_connections": 0}

        for agent_id in range(self.n_agents):
            incompatible = self.find_incompatible_connections(agent_id)

            if incompatible and random.random() < self.rewire_prob:
                # 随机选择一个不兼容的连接断开
                to_disconnect = random.choice(incompatible)
                self.graph.remove_edge(agent_id, to_disconnect)
                rewire_stats["disconnections"] += 1

                # 寻找兼容的主体进行连接
                compatible_agent = self.find_compatible_agent(agent_id)
                if compatible_agent is not None:
                    self.graph.add_edge(agent_id, compatible_agent)
                    rewire_stats["new_connections"] += 1

        return rewire_stats

    def step(self) -> Dict[str, Any]:
        """执行一次迭代"""
        # 同步更新意见
        new_opinions = np.zeros(self.n_agents)
        for agent_id in range(self.n_agents):
            new_opinions[agent_id] = self.calculate_opinion_influence(agent_id)

        self.opinions = new_opinions

        # 同步重新连接
        rewire_stats = self.rewire_connections()

        # 记录历史
        self.opinion_history.append(self.opinions.copy())

        # 计算统计信息
        stats = {
            "step": len(self.opinion_history) - 1,
            "mean_opinion": np.mean(self.opinions),
            "opinion_variance": np.var(self.opinions),
            "num_edges": self.graph.number_of_edges(),
            "rewire_stats": rewire_stats,
        }

        return stats

    def run_simulation(self, n_steps: int, verbose: bool = True) -> List[Dict]:
        """运行模拟"""
        stats_history = []

        for step in range(n_steps):
            stats = self.step()
            stats_history.append(stats)

            if verbose and step % 50 == 0:
                print(
                    f"Step {step}: Mean opinion = {stats['mean_opinion']:.3f}, "
                    f"Variance = {stats['opinion_variance']:.3f}, "
                    f"Edges = {stats['num_edges']}"
                )

        return stats_history
