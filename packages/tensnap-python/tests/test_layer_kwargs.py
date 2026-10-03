"""Runtime checks for precise layer option dispatch."""

from tensnap import agent, agent_layer, env
from tensnap.bindings import layer_bindings


def test_registered_item_class_resolves_before_callable_constructor() -> None:
    @agent()
    class Bird:
        def __init__(self) -> None:
            self.id = "bird-1"
            self.x = 2
            self.y = 3

    @agent_layer("birds", item_projector=Bird)
    @env("world")
    class Model:
        def __init__(self) -> None:
            self.birds = [Bird()]

    model = Model()
    layer = next(
        binding for binding in layer_bindings(model) if binding.layer_id == "birds"
    )
    assert layer.build_item_list(model) == [{"id": "bird-1", "x": 2, "y": 3}]
