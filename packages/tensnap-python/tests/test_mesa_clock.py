import asyncio

import mesa
import pytest

from tensnap import mesa_model_time, scene_restore
from tensnap.bindings import scene_restore_binding
from tensnap.bindings.mesa import mesa_clock_restore


@scene_restore(time=mesa_clock_restore)
class CountingModel(mesa.Model):
    def __init__(self):
        super().__init__(rng=7)
        self.calls = 0

    def step(self):
        self.calls += 1

    def on_event(self):
        self.calls += 100


def _project_time(model: CountingModel, time: int | float) -> None:
    restore, _, _ = scene_restore_binding(model).bind(model)
    assert restore is not None
    asyncio.run(restore({"time": time}))


def test_restore_rebases_next_step_when_clock_moves_both_directions() -> None:
    model = CountingModel()
    model.step()
    assert model.calls == 1

    forward_time = 8
    backward_time = 2
    _project_time(model, forward_time)
    assert mesa_model_time(model) == forward_time
    assert model.calls == 1
    model.step()
    assert mesa_model_time(model) == forward_time + 1
    assert model.calls == 1 + 1

    _project_time(model, backward_time)
    assert mesa_model_time(model) == backward_time
    model.step()
    assert mesa_model_time(model) == backward_time + 1
    assert model.calls == 1 + 1 + 1


def test_invalid_clock_is_rejected_before_mutation() -> None:
    model = CountingModel()
    for value in (-1, 1.5, float("nan"), True):
        with pytest.raises(ValueError, match="nonnegative integer"):
            _project_time(model, value)
        assert mesa_model_time(model) == 0
        assert model.calls == 0


def test_extra_future_event_requires_model_checkpoint() -> None:
    model = CountingModel()
    if not hasattr(model, "schedule_event"):
        return
    model.schedule_event(model.on_event, after=1.5)
    with pytest.raises(ValueError, match="other pending events"):
        _project_time(model, 8)
    assert mesa_model_time(model) == 0
    model.step()
    assert model.calls == 1
