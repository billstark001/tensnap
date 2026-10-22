"""Naming-game graph, agent inspection, controls, and charts."""

from dataclasses import replace
from typing import Annotated

from tensnap import (
    BindParameterConfig,
    NumberParameter,
    agent,
    agent_layer,
    chart,
    edge,
    edge_layer,
    env,
    monitor,
)

from ..common.config import integer, probability
from ..common.viz import ModelView, controls
from .model import Interaction, Player
from .scenarios import INITIAL_NAMES, LAYOUTS, NAMING_SCENARIOS, TOPOLOGIES

agent(id="id", x="x", y="y", color="color", icon="circle", size=0.65, data="data")(
    Player
)
edge(
    directed=False,
    color=lambda contact: "#059669" if contact.success else "#94a3b8",
    width=lambda contact: 0.08 if contact.age == 0 else 0.025,
)(Interaction)


@controls(
    {"exploration": NumberParameter("", min=0, max=1, step=0.01)},
    include=["agent_count", "topology", "initial_names", "layout", "degree"],
)
@edge_layer(
    "contacts",
    agent_layer_id="agents",
    items_projector=lambda view: view.contacts,
    link_distance=-1,
    z_index=0,
)
@edge_layer(
    "interactions",
    agent_layer_id="agents",
    item_iterable_projector="model.recent_edges",
    link_distance=-1,
    charge_strength=0,
    centering_strength=0,
    collision_radius=0,
    z_index=1,
)
@agent_layer("agents", coord_offset="float", z_index=2)
@env("main")
class NamingView(ModelView):
    """Declare graph projection and researcher-facing controls around one model."""

    exploration: float
    scenarios = NAMING_SCENARIOS
    initial_options = ("agents", "topology", "initial_names", "layout", "degree")
    agent_count: Annotated[
        int,
        BindParameterConfig(
            "number",
            label="Agent count",
            min=2,
            max=200,
            step=1,
            allow_runtime_change=False,
        ),
    ]
    topology: Annotated[
        str,
        BindParameterConfig(
            "enum", options=list(TOPOLOGIES), allow_runtime_change=False
        ),
    ]
    initial_names: Annotated[
        str,
        BindParameterConfig(
            "enum", options=list(INITIAL_NAMES), allow_runtime_change=False
        ),
    ]
    layout: Annotated[
        str,
        BindParameterConfig("enum", options=list(LAYOUTS), allow_runtime_change=False),
    ]
    degree: Annotated[
        int,
        BindParameterConfig(
            "number",
            label="Regular graph degree",
            min=2,
            max=198,
            step=2,
            allow_runtime_change=False,
        ),
    ]

    @property
    def agent_count(self):
        return self._initial_value("agents")

    @agent_count.setter
    def agent_count(self, value):
        self._set_initial_option("agents", integer(value, "agents", 2, 200))

    @property
    def topology(self):
        return self._initial_value("topology")

    @topology.setter
    def topology(self, value):
        self._set_initial_option("topology", value)

    @property
    def initial_names(self):
        return self._initial_value("initial_names")

    @initial_names.setter
    def initial_names(self, value):
        self._set_initial_option("initial_names", value)

    @property
    def layout(self):
        return self._initial_value("layout")

    @layout.setter
    def layout(self, value):
        self._set_initial_option("layout", value)

    @property
    def degree(self):
        return self._initial_value("degree")

    @degree.setter
    def degree(self, value):
        self._set_initial_option("degree", integer(value, "degree", 2, 198))

    @property
    def contacts(self):
        network = self.model.network
        return [
            {
                "source": network.agent_ids[a],
                "target": network.agent_ids[b],
                "directed": False,
                "color": "#a78bfa"
                if network.communities[network.agent_ids[a]]
                != network.communities[network.agent_ids[b]]
                else "#cbd5e1",
                "width": 0.025,
            }
            for a, b in sorted((min(a, b), max(a, b)) for a, b in network.graph.edges)
        ]

    @property
    def exploration(self) -> float:
        """Read the current baseline exploration probability."""
        return self.model.config.exploration

    @exploration.setter
    def exploration(self, value):
        """Validate interactive changes before replacing the immutable configuration."""
        self.model.config = replace(
            self.model.config, exploration=probability(value, "exploration")
        )

    @chart(
        "names",
        "Current names",
        data_list=[
            {"id": "Q", "label": "Q", "color": "#2563eb"},
            {"id": "M", "label": "M", "color": "#d97706"},
            {"id": "unseen", "label": "Unassigned", "color": "#94a3b8"},
        ],
    )
    def names(self):
        """Publish Q/M shares, including players that have not acted yet."""
        values = self.model.metrics()
        return {
            "Q": values["q_share"],
            "M": values["m_share"],
            "unseen": values["unseen_share"],
        }

    @chart("coordination_rate", "Cumulative successful interactions", color="#059669")
    def coordination_rate(self):
        """Report the cumulative fraction of matching pairwise decisions."""
        return self.model.metrics()["coordination_rate"]

    @monitor("last_interaction", "Last pairwise interaction", render_hint="tree")
    def last_interaction(self):
        """Keep the most recent event available without navigating chart history."""
        return self.model.last_interaction

    @monitor("contact_network", "Allowed contacts / fixed minority", render_hint="tree")
    def contact_network(self):
        return {
            **self.model.network_summary(),
            "population": self.model.config.agents,
            "initial_names": self.model.config.initial_names,
            "layout": self.model.config.layout,
        }

    @chart(
        "ordinary_target_share",
        "Ordinary agents: recent target choices",
        color="#dc2626",
    )
    def ordinary_target_share(self):
        # Wire chart samples require a number/string. Missingness remains explicit
        # in the metrics monitor; zero is only the chart's pre-observation value.
        value = self.model.metrics().get("ordinary_target_choice_share")
        return value if value is not None else 0.0
