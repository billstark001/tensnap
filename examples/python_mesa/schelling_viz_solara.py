import solara

from mesa.visualization import (
    Slider,
    SolaraViz,
    SpaceRenderer,
    make_plot_component,
)
from mesa.visualization.components import AgentPortrayalStyle

from schelling import SchellingModel, SchellingAgent


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
    "width": Slider("Grid width", 50, 5, 150, 1, dtype=int),
    "height": Slider("Grid height", 50, 5, 150, 1, dtype=int),
    "density": Slider("Density", 0.8, 0.01, 1.0, 0.01, dtype=float),  # type: ignore
    "similarity_threshold": Slider(
        "Similarity threshold", 0.7, 0.0, 1.0, 0.01, dtype=float  # type: ignore
    ),
    "rng": {
        "type": "InputText",
        "value": 42,
        "label": "Random seed",
    },
}

model = SchellingModel()

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
    name="Schelling model: Go-equivalent dynamics",
)

page
