"""
Agent-based SIRS Model Implementation

This module implements a SIRS (Susceptible-Infected-Recovered-Susceptible)
epidemiological model with support for three different interaction structures:
- Well-mixed (all agents interact with all agents)
- Grid (agents interact with neighbors in a rectangular grid)
- Erdős-Rényi network (agents interact through random connections)
"""

from enum import IntEnum

import networkx as nx
import numpy as np
from tensnap import (
    NumberParameter,
    agent,
    agent_layer,
    chart,
    edge_layer,
    env,
    grid_layer,
    params,
    uniform_agent,
)


class State(IntEnum):
    """Enumeration for agent health states."""

    SUSCEPTIBLE = 0
    INFECTED = 1
    RECOVERED = 2


@agent(x="grid_x", y="grid_y")
@uniform_agent()
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
        self.grid_x = 0
        self.grid_y = 0

    icon = "square"
    size = 0.95

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
        self.agents: list[Agent] = []

    def init(self, rng: np.random.Generator):
        """Rebuild any stochastic topology using the simulation-owned RNG."""

    def get_neighbors(self, agent_id: int) -> list[int]:
        """
        Get the neighbors of a given agent.

        Args:
            agent_id: ID of the agent

        Returns:
            List of neighbor agent IDs
        """
        raise NotImplementedError("Subclasses must implement get_neighbors()")


@env(id="sirs_well_mixed", type="uniform")
@agent_layer("agents")
class WellMixedEnvironment(Environment):
    """
    Well-mixed environment where all agents can interact with all other agents.

    This represents a homogeneous population with no spatial or network structure.
    """

    def get_neighbors(self, agent_id: int) -> list[int]:
        """
        Get all other agents as neighbors.

        Args:
            agent_id: ID of the agent

        Returns:
            List of all agent IDs except the given agent
        """
        return [i for i in range(self.num_agents) if i != agent_id]


@env(id="sirs_grid")
@grid_layer(width="width", height="height")
@agent_layer("agents")
@params(
    include=["rows", "cols"],
    custom_bindings={
        "rows": NumberParameter(
            "", min=1, max=10000, step=1, allow_runtime_change=False
        ),
        "cols": NumberParameter(
            "", min=1, max=10000, step=1, allow_runtime_change=False
        ),
    },
)
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
        self._active_rows, self._active_cols = rows, cols

    @property
    def width(self):
        return self._active_cols

    @property
    def height(self):
        return self._active_rows

    def init(self, rng: np.random.Generator):
        self._active_rows, self._active_cols = self.rows, self.cols
        self.num_agents = self.rows * self.cols

    def _id_to_coords(self, agent_id: int) -> tuple[int, int]:
        """Convert agent ID to grid coordinates."""
        return agent_id // self._active_cols, agent_id % self._active_cols

    def _coords_to_id(self, row: int, col: int) -> int:
        """Convert grid coordinates to agent ID."""
        return row * self._active_cols + col

    def get_neighbors(self, agent_id: int) -> list[int]:
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
            if 0 <= new_row < self._active_rows and 0 <= new_col < self._active_cols:
                neighbors.append(self._coords_to_id(new_row, new_col))

        return neighbors


@env(id="sirs_graph")
@agent_layer("agents")
@edge_layer(
    "edges",
    agent_layer_id="agents",
    item_iterable_projector="graph.edges",
    item_dynamic_projector="render_tensnap_edge",
)
@params(
    include=["num_agents", "connection_prob"],
    custom_bindings={
        "num_agents": NumberParameter(
            "", min=1, max=10000, step=1, allow_runtime_change=False
        ),
        "connection_prob": NumberParameter(
            "", min=0, max=1, allow_runtime_change=False
        ),
    },
)
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
        """
        super().__init__(num_agents)
        self.num_agents = num_agents
        self.connection_prob = connection_prob

    def render_tensnap_edge(self, edge: tuple[int, int]) -> dict:
        return {
            "source": edge[0],
            "target": edge[1],
            "color": "#95A5A6",
            "width": 0.1,
        }

    def init(self, rng: np.random.Generator):
        self.graph = nx.erdos_renyi_graph(
            self.num_agents, self.connection_prob, seed=rng
        )

    def get_neighbors(self, agent_id: int) -> list[int]:
        """
        Get neighbors of an agent in the network.

        Args:
            agent_id: ID of the agent

        Returns:
            List of neighbor agent IDs based on network connections
        """
        return list(self.graph.neighbors(agent_id))


@params(
    include=["beta", "gamma", "xi", "initial_infected", "seed"],
    custom_bindings={
        "seed": NumberParameter(
            "", min=0, max=2**32 - 1, step=1, allow_runtime_change=False
        ),
        "initial_infected": NumberParameter("", step=1, allow_runtime_change=False),
    },
)
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
        seed: int = 7,
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
        self.seed = seed
        self.environment = environment
        self.beta = beta
        self.gamma = gamma
        self.xi = xi
        self.initial_infected = initial_infected

        self.init()

    def init(self):
        self.rng = np.random.default_rng(self.seed)
        self.environment.init(self.rng)
        # Initialize agents
        self.agents = [Agent(i) for i in range(self.environment.num_agents)]
        self.environment.agents = self.agents

        if isinstance(self.environment, GridEnvironment):
            for person in self.agents:
                row, col = self.environment._id_to_coords(person.id)
                person.grid_x = col
                person.grid_y = row

        # Randomly select initial infected agents
        initial_infected_ids = self.rng.choice(
            self.environment.num_agents,
            size=min(self.initial_infected, self.environment.num_agents),
            replace=False,
        )
        for agent_id in initial_infected_ids:
            self.agents[agent_id].update_state(State.INFECTED)

        # Track history
        self.history = {"susceptible": [], "infected": [], "recovered": []}
        self.last_states = self.count_states(add_history=True)

    def count_states(self, add_history: bool = False) -> tuple[int, int, int]:
        """Count agents in each state."""
        counts = [0, 0, 0]
        for person in self.agents:
            counts[person.state] += 1
        if add_history:
            self.history["susceptible"].append(counts[0])
            self.history["infected"].append(counts[1])
            self.history["recovered"].append(counts[2])
        return tuple(counts)  # type: ignore

    def step(self) -> None:
        """Execute one time step of the simulation."""
        new_states = [person.state for person in self.agents]

        for person in self.agents:
            if person.is_susceptible():
                # S -> I: Check for infection from neighbors
                neighbors = self.environment.get_neighbors(person.id)
                for neighbor_id in neighbors:
                    if (
                        self.agents[neighbor_id].is_infected()
                        and self.rng.random() < self.beta
                    ):
                        new_states[person.id] = State.INFECTED
                        break

            elif person.is_infected():
                # I -> R: Recovery
                if self.rng.random() < self.gamma:
                    new_states[person.id] = State.RECOVERED

            elif person.is_recovered():
                # R -> S: Loss of immunity
                if self.rng.random() < self.xi:
                    new_states[person.id] = State.SUSCEPTIBLE

        # Update all agents simultaneously
        for person, new_state in zip(self.agents, new_states):
            person.update_state(new_state)

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
        susceptible, infected, recovered = self.last_states
        return {
            "susceptible": susceptible,
            "infected": infected,
            "recovered": recovered,
        }

    def run(self, num_steps: int):
        for _ in range(num_steps):
            self.step()
