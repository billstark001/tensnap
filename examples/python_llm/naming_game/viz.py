"""Naming-game graph, agent inspection, controls, and charts."""

from dataclasses import replace

from tensnap import (
    NumberParameter,
    agent,
    agent_layer,
    chart,
    edge,
    edge_layer,
    env,
    monitor,
)

from ..common.config import probability
from ..common.viz import ModelView, controls
from .model import Interaction, Player

agent(id="id", x="x", y="y", color="color", icon="circle", size=0.65, data="data")(
    Player
)
edge(
    directed=False,
    color=lambda contact: "#059669" if contact.success else "#94a3b8",
    width=lambda contact: 0.08 if contact.age == 0 else 0.025,
)(Interaction)


@controls({"exploration": NumberParameter("", min=0, max=1, step=0.01)})
@edge_layer(
    "interactions",
    agent_layer_id="agents",
    item_iterable_projector="model.recent_edges",
    link_distance=2,
    charge_strength=0,
    centering_strength=0,
    collision_radius=0,
)
@agent_layer("agents", coord_offset="float")
@env("main")
class NamingView(ModelView):
    """Declare graph projection and researcher-facing controls around one model."""

    exploration: float

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
        "Last choices",
        data_list=[
            {"id": "Q", "label": "Q", "color": "#2563eb"},
            {"id": "M", "label": "M", "color": "#d97706"},
            {"id": "unseen", "label": "Not yet activated", "color": "#94a3b8"},
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
        return self.model.network_summary()

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
