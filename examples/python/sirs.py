"""
Agent-based SIRS Model Implementation

This module implements a SIRS (Susceptible-Infected-Recovered-Susceptible)
epidemiological model with support for three different interaction structures:
- Well-mixed (all agents interact with all agents)
- Grid (agents interact with neighbors in a rectangular grid)
- Erdős-Rényi network (agents interact through random connections)
"""

import numpy as np
import networkx as nx
from typing import List, Tuple, Optional
from enum import IntEnum


from tensnap import (
    bind_parameters,
    bind_uniform_agent,
    bind_grid_environment,
    bind_graph_environment,
    bind_graph_agent,
    chart,
)

class State(IntEnum):
    """Enumeration for agent health states."""

    SUSCEPTIBLE = 0
    INFECTED = 1
    RECOVERED = 2


@bind_graph_agent(color=True)
@bind_uniform_agent(color=True)
class Agent:
    """
    Represents an individual agent in the SIRS model.

    Attributes:
        id: Unique identifier for the agent
        state: Current health state (Susceptible, Infected, or Recovered)
    """

    def __init__(self, agent_id: int, initial_state: State = State.SUSCEPTIBLE):
        """
        Initialize an agent.

        Args:
            agent_id: Unique identifier for the agent
            initial_state: Initial health state (default: SUSCEPTIBLE)
        """
        self.id = agent_id
        self.state = initial_state

    @property
    def color(self) -> str:
        if self.state == State.SUSCEPTIBLE:
            return "blue"
        elif self.state == State.INFECTED:
            return "red"
        elif self.state == State.RECOVERED:
            return "green"
        else:
            return "gray"

    def update_state(self, new_state: State) -> None:
        """Update the agent's health state."""
        self.state = new_state

    def is_susceptible(self) -> bool:
        """Check if agent is susceptible."""
        return self.state == State.SUSCEPTIBLE

    def is_infected(self) -> bool:
        """Check if agent is infected."""
        return self.state == State.INFECTED

    def is_recovered(self) -> bool:
        """Check if agent is recovered."""
        return self.state == State.RECOVERED


class Environment:
    """
    Base class for interaction environments.

    Defines the structure of how agents interact with each other.
    """

    def __init__(self, num_agents: int):
        """
        Initialize the environment.

        Args:
            num_agents: Total number of agents in the environment
        """
        self.num_agents = num_agents
        self.agents: List[Agent] = []

    def init(self):
        pass

    def get_neighbors(self, agent_id: int) -> List[int]:
        """
        Get the neighbors of a given agent.

        Args:
            agent_id: ID of the agent

        Returns:
            List of neighbor agent IDs
        """
        raise NotImplementedError("Subclasses must implement get_neighbors()")


class WellMixedEnvironment(Environment):
    """
    Well-mixed environment where all agents can interact with all other agents.

    This represents a homogeneous population with no spatial or network structure.
    """

    def get_neighbors(self, agent_id: int) -> List[int]:
        """
        Get all other agents as neighbors.

        Args:
            agent_id: ID of the agent

        Returns:
            List of all agent IDs except the given agent
        """
        return [i for i in range(self.num_agents) if i != agent_id]


color_rgb_np_array_map = {
    State.SUSCEPTIBLE: np.array([0, 0, 255], dtype=np.uint8),
    State.INFECTED: np.array([255, 0, 0], dtype=np.uint8),
    State.RECOVERED: np.array([0, 255, 0], dtype=np.uint8),
}


@bind_grid_environment(width="rows", height="cols", background=True)
@bind_parameters(include=["rows", "cols"])
class GridEnvironment(Environment):
    """
    Rectangular grid environment where agents interact with their spatial neighbors.

    Agents are arranged in a grid and can only interact with adjacent agents
    (4-connectivity: up, down, left, right).
    """

    def __init__(self, rows: int, cols: int):
        """
        Initialize the grid environment.

        Args:
            rows: Number of rows in the grid
            cols: Number of columns in the grid
        """
        super().__init__(rows * cols)
        self.rows = rows
        self.cols = cols

    def _id_to_coords(self, agent_id: int) -> Tuple[int, int]:
        """Convert agent ID to grid coordinates."""
        return agent_id // self.cols, agent_id % self.cols

    def _coords_to_id(self, row: int, col: int) -> int:
        """Convert grid coordinates to agent ID."""
        return row * self.cols + col

    def get_neighbors(self, agent_id: int) -> List[int]:
        """
        Get neighboring agents in the grid (4-connectivity).

        Args:
            agent_id: ID of the agent

        Returns:
            List of neighbor agent IDs (up to 4 neighbors)
        """
        row, col = self._id_to_coords(agent_id)
        neighbors = []

        # Check all 4 directions
        for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            new_row, new_col = row + dr, col + dc
            if 0 <= new_row < self.rows and 0 <= new_col < self.cols:
                neighbors.append(self._coords_to_id(new_row, new_col))

        return neighbors

    def get_status_image(self):
        """Get a 2D array representing the current states of agents in the grid."""
        status_image = np.zeros((self.rows, self.cols, 3), dtype=np.uint8)
        for agent_id in range(self.num_agents):
            row, col = self._id_to_coords(agent_id)
            status_image[row, col] = color_rgb_np_array_map[self.agents[agent_id].state]
        return status_image

    @property
    def background(self):
        """Get the background image representing agent states."""
        img = self.get_status_image()
        return img


@bind_graph_environment(edges="graph.edges")
@bind_parameters(include=["num_agents", "connection_prob"])
class ERNetworkEnvironment(Environment):
    """
    Erdős-Rényi random network environment.

    Agents are connected through a random graph where each pair of agents
    is connected with a given probability.
    """

    def __init__(self, num_agents: int, connection_prob: float):
        """
        Initialize the Erdős-Rényi network.

        Args:
            num_agents: Number of agents (nodes in the network)
            connection_prob: Probability of connection between any two agents
            seed: Random seed for reproducibility (optional)
        """
        super().__init__(num_agents)
        self.num_agents = num_agents
        self.connection_prob = connection_prob

    def init(self, seed: Optional[int] = None):
        self.graph = nx.erdos_renyi_graph(
            self.num_agents, self.connection_prob, seed=seed
        )

    def get_neighbors(self, agent_id: int) -> List[int]:
        """
        Get neighbors of an agent in the network.

        Args:
            agent_id: ID of the agent

        Returns:
            List of neighbor agent IDs based on network connections
        """
        return list(self.graph.neighbors(agent_id))


@bind_parameters(include=["beta", "gamma", "xi", "initial_infected"])
class SIRSSimulation:
    """
    SIRS epidemic simulation manager.

    Manages the simulation of disease spread through a population of agents
    in a given environment.
    """

    def __init__(
        self,
        environment: Environment,
        beta: float,
        gamma: float,
        xi: float,
        initial_infected: int = 1,
    ):
        """
        Initialize the SIRS simulation.

        Args:
            environment: The interaction environment
            beta: Infection rate (probability of S->I transition upon contact)
            gamma: Recovery rate (probability of I->R transition per time step)
            xi: Loss of immunity rate (probability of R->S transition per time step)
            initial_infected: Number of initially infected agents
            seed: Random seed for reproducibility (optional)
        """
        self.environment = environment
        self.beta = beta
        self.gamma = gamma
        self.xi = xi
        self.initial_infected = initial_infected

        self.init()

        self.last_states: Tuple[int, int, int] = (0, 0, 0)  # S, I, R counts

    def init(self):
        # Initialize agents
        self.agents = [Agent(i) for i in range(self.environment.num_agents)]
        self.environment.agents = self.agents
        self.environment.init()

        # Randomly select initial infected agents
        initial_infected_ids = np.random.choice(
            self.environment.num_agents,
            size=min(self.initial_infected, self.environment.num_agents),
            replace=False,
        )
        for agent_id in initial_infected_ids:
            self.agents[agent_id].update_state(State.INFECTED)

        # Track history
        self.history = {"susceptible": [], "infected": [], "recovered": []}
        self.last_states = self.count_states(add_history=True)

    def count_states(self, add_history: bool = False) -> Tuple[int, int, int]:
        """Count agents in each state."""
        counts = [0, 0, 0]
        for agent in self.agents:
            counts[agent.state] += 1
        if add_history:
            self.history["susceptible"].append(counts[0])
            self.history["infected"].append(counts[1])
            self.history["recovered"].append(counts[2])
        return tuple(counts)  # type: ignore

    def step(self) -> None:
        """Execute one time step of the simulation."""
        new_states = [agent.state for agent in self.agents]

        for agent in self.agents:
            if agent.is_susceptible():
                # S -> I: Check for infection from neighbors
                neighbors = self.environment.get_neighbors(agent.id)
                for neighbor_id in neighbors:
                    if self.agents[neighbor_id].is_infected():
                        if np.random.random() < self.beta:
                            new_states[agent.id] = State.INFECTED
                            break

            elif agent.is_infected():
                # I -> R: Recovery
                if np.random.random() < self.gamma:
                    new_states[agent.id] = State.RECOVERED

            elif agent.is_recovered():
                # R -> S: Loss of immunity
                if np.random.random() < self.xi:
                    new_states[agent.id] = State.SUSCEPTIBLE

        # Update all agents simultaneously
        for agent, new_state in zip(self.agents, new_states):
            agent.update_state(new_state)

        # Record current state counts
        self.last_states = self.count_states(add_history=True)

    @chart(
        "sir",
        "S/I/R",
        color="#3498DB",
        data_list=[
            {"id": "susceptible", "label": "Susceptible", "color": "#3498DB"},
            {"id": "infected", "label": "Infected", "color": "#E74C3C"},
            {"id": "recovered", "label": "Recovered", "color": "#2ECC71"},
        ],
    )
    def get_current_states(self):
        (susceptible, infected, recovered) = self.last_states
        return {
            "susceptible": susceptible,
            "infected": infected,
            "recovered": recovered,
        }

    def run(self, num_steps: int):
        for _ in range(num_steps):
            self.step()
