"""Commons resource grid, harvesters, local messages, and charts."""

from dataclasses import asdict, replace
from typing import Annotated

from tensnap import (
    BindParameterConfig,
    agent_layer,
    chart,
    env,
    grid_layer,
    layer_restore,
    matrix_agent_layer,
    monitor,
)

from ..common.config import probability
from ..common.viz import ModelView
from .model import Harvester
from .restore import restore_layers
from .scenarios import COMMONS_RULES, COMMONS_SCENARIOS


def harvester_item(view, player: Harvester):
    """Align top-down model rows with the matrix layer's bottom-up scene y."""
    return {
        "id": player.id,
        "x": player.x,
        "y": view.model.config.height - 1 - player.y,
        "icon": "circle",
        "size": 0.65,
        "color": "#7c3aed",
        "data": player.data,
    }


def resource_color(view, row, col, resource):
    """Distinguish barren cells from fertile cells containing zero to three units."""
    if not view.model.habitat[row][col]:
        return "#f1f5f9"
    return ["#fde6c8", "#bbf7d0", "#4ade80", "#15803d"][resource]


@layer_restore(layer_id="agents", replace="restore_agents", metadata="restore_derived")
@layer_restore(
    layer_id="resources", replace="restore_resources", metadata="restore_derived"
)
@layer_restore(layer_id="grid", metadata="restore_derived")
@grid_layer(
    "grid",
    width=lambda view: view.model.config.width,
    height=lambda view: view.model.config.height,
    z_index=1,
)
@agent_layer(
    "agents",
    width=lambda view: view.model.config.width,
    height=lambda view: view.model.config.height,
    item_dynamic_projector=harvester_item,
    z_index=2,
    metadata={
        "model_config": lambda view: asdict(view.model.config),
        "active_policy": "active_policy",
    },
)
@matrix_agent_layer(
    "resources",
    source=lambda view: view.model.resources,
    fields={
        "data": lambda view, key, resource: {
            "value": resource,
            "fertile": view.model.habitat[key[0]][key[1]],
        }
    },
    icon="square",
    color=resource_color,
    size=0.96,
    z_index=0,
    restore=False,
)
@env("main")
class CommonsView(ModelView):
    """Expose spatial resources, local behavior and global researcher metrics."""

    regrowth: Annotated[float, BindParameterConfig("number", min=0, max=1, step=0.05)]
    rule: Annotated[str, BindParameterConfig("enum", options=list(COMMONS_RULES))]
    scenarios = COMMONS_SCENARIOS

    restore_layers = staticmethod(restore_layers)

    def restore_resources(self, items):
        self.model.resources = self._restored_model.resources

    def restore_measurements(self, candidate):
        self.model.messages = candidate.messages
        self.model.last_event = candidate.last_event

    @property
    def regrowth(self) -> float:
        """Read the environmental regeneration multiplier."""
        return self.model.config.regrowth

    @regrowth.setter
    def regrowth(self, value):
        """Validate changes; the next regeneration event uses the accepted value."""
        self.model.config = replace(
            self.model.config, regrowth=probability(value, "regrowth")
        )

    @property
    def rule(self) -> str:
        """Read the scripted baseline strategy; this setting does not affect LLMs."""
        return self.model.config.rule

    @rule.setter
    def rule(self, value):
        """Change the baseline through the same validated configuration constructor."""
        self.model.config = replace(self.model.config, rule=value)

    @chart("resource", "Remaining resource", color="#15803d")
    def resource(self):
        """Track remaining units across the whole grid."""
        return self.model.metrics()["resource"]

    @chart("harvested", "Cumulative harvest", color="#d97706")
    def harvested(self):
        """Track cumulative yield, including agents outside the selected local view."""
        return self.model.metrics()["harvested"]

    @chart("gini", "Harvest inequality (Gini)", color="#7c3aed")
    def gini(self):
        """Track inequality of accumulated harvest rather than current-cell resources."""
        return self.model.metrics()["gini"]

    @monitor("local_messages", "Recent local messages", render_hint="tree")
    def messages(self):
        """Let the researcher inspect all recent messages, beyond agent hearing range."""
        return self.model.messages

    @monitor("last_event", "Last activation", render_hint="tree")
    def last_event(self):
        """Show the last completed activation and its actual harvest gain."""
        return self.model.last_event

    @monitor("treatment", "Delivery / drought / fertile components", render_hint="tree")
    def treatment(self):
        return {
            "message_delivery": self.model.config.message_delivery,
            "drought_start": self.model.config.drought_start,
            "drought_duration": self.model.config.drought_duration,
            "drought_active": self.model.drought_active(),
            "effective_regrowth": self.model.effective_regrowth(),
            "component_cells": self.model.components,
        }
