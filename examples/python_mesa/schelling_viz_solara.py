import os

import solara

from mesa.visualization import (
    Slider,
    SolaraViz,
    SpaceRenderer,
    make_plot_component,
)
from mesa.visualization.components import AgentPortrayalStyle

from schelling import SchellingModel, SchellingAgent
from schelling_harness import model_kwargs_from_environment


MODEL_KWARGS = model_kwargs_from_environment()
try:
    TICKS_PER_SECOND = max(1, int(os.environ.get("TENSNAP_SCHELLING_TICKS_PER_SECOND", "60")))
except ValueError:
    TICKS_PER_SECOND = 60


def agent_portrayal(agent: SchellingAgent):
    return AgentPortrayalStyle(
        x=agent.cell.coordinate[0],
        y=agent.cell.coordinate[1],
        color="#3498db" if agent.group == 1 else "#e74c3c",
        marker="s",
        size=55,
        alpha=0.95,
    )


def model_summary(model):
    return solara.Markdown(f"""
**SatisfiedPct:** {model.satisfied_pct():.3f}  
**SegregationIndex:** {model.segregation_index():.3f}  
**Moved last step:** {model.last_swapped}
""")


model_params = {
    "width": Slider("Grid width", MODEL_KWARGS["width"], 5, 150, 1, dtype=int),
    "height": Slider("Grid height", MODEL_KWARGS["height"], 5, 150, 1, dtype=int),
    "density": Slider("Density", MODEL_KWARGS["density"], 0.01, 1.0, 0.01, dtype=float),  # type: ignore
    "balance": Slider("Balance", MODEL_KWARGS["balance"], 0.0, 1.0, 0.01, dtype=float),  # type: ignore
    "similarity_threshold": Slider(
        "Similarity threshold", MODEL_KWARGS["similarity_threshold"], 0.0, 1.0, 0.01, dtype=float  # type: ignore
    ),
    "rng": {
        "type": "InputText",
        "value": "" if MODEL_KWARGS["rng"] is None else str(MODEL_KWARGS["rng"]),
        "label": "Random seed",
    },
}

model = SchellingModel(**MODEL_KWARGS)

renderer = SpaceRenderer(model, backend="matplotlib").setup_agents(agent_portrayal)
renderer.render()

SatisfiedPlot = make_plot_component(
    {
        "SatisfiedPct": "tab:green",
        "SegregationIndex": "tab:purple",
    }
)

page = SolaraViz(
    model,
    renderer,
    components=[
        SatisfiedPlot,
        model_summary,
    ],  # type: ignore
    model_params=model_params,
    play_interval=max(1, round(1000 / TICKS_PER_SECOND)),
    name="Schelling model: Go-equivalent dynamics",
)
