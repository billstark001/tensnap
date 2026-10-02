import asyncio
from unittest.mock import AsyncMock

from tensnap import agent_layer, checkpoint, env, layer_restore, scene_restore
from tensnap.bindings.basic.restore import encode_checkpoint
from tensnap.scenario import SimulationScenario
from tensnap.server import ServerToClientMessageType


def test_composed_restore_reconciles_complete_layer_and_rejects_before_mutation():
    @checkpoint(capture="capture", restore="restore_checkpoint")
    @scene_restore(
        time="restore_time", before_apply="before_apply", after_apply="after_apply"
    )
    @layer_restore(create="put_bird", update="put_bird", delete="delete_bird")
    @agent_layer("birds", items_projector=lambda birds: list(birds.birds.values()))
    @env("main")
    class Birds:
        def __init__(self):
            self.birds = {"old": {"id": "old", "x": 0}}
            self.time = 0
            self.phases = []

        def before_apply(self, payload):
            self.phases.append(("before", payload["request_id"], tuple(self.birds)))

        def after_apply(self, payload):
            self.phases.append(("after", payload["request_id"], tuple(self.birds)))

        def put_bird(self, item):
            self.birds[item["id"]] = dict(item)

        def delete_bird(self, key):
            self.birds.pop(key["id"])

        def restore_time(self, time):
            self.time = time

        def capture(self):
            return {"birds": dict(self.birds), "time": self.time}

        def restore_checkpoint(self, data):
            self.birds = dict(data["birds"])
            self.time = data["time"]

    model = Birds()
    restored_time = 7
    scenario = SimulationScenario(model_id="birds")
    scenario.add_environment(model)
    scenario.add_scene_restore(model)
    scenario.server.send = AsyncMock()

    async def restore(request_id, items):
        await scenario._on_scene_restore(
            None,
            {
                "request_id": request_id,
                "model_id": "birds",
                "time": restored_time,
                "envs": [
                    {
                        "id": "main",
                        "type": "2d",
                        "layers": [
                            {
                                "layer_id": "birds",
                                "layer_type": "agent",
                                "items": items,
                            }
                        ],
                    }
                ],
            },
        )
        return [
            call.args[2]
            for call in scenario.server.send.call_args_list
            if call.args[1] == ServerToClientMessageType.SCENE_RESTORE_END
        ][-1]

    rejected = asyncio.run(restore("bad", [{"id": "new"}, {"id": "new"}]))
    assert rejected["status"] == "rejected"
    assert model.birds == {"old": {"id": "old", "x": 0}}
    assert model.phases == []

    accepted = asyncio.run(restore("ok", [{"id": "new", "x": 3}]))
    assert accepted["status"] == "ok"
    assert model.birds == {"new": {"id": "new", "x": 3}}
    assert model.time == restored_time
    assert model.phases == [("before", "ok", ("old",)), ("after", "ok", ("new",))]

    saved_checkpoint = encode_checkpoint(
        {"birds": {"checkpoint": {"id": "checkpoint", "x": 4}}, "time": 1},
        use_msgpack=False,
    )
    asyncio.run(
        scenario._on_scene_restore(
            None,
            {
                "request_id": "combined",
                "model_id": "birds",
                "checkpoint": saved_checkpoint,
                "envs": [
                    {
                        "id": "main",
                        "type": "2d",
                        "layers": [
                            {
                                "layer_id": "birds",
                                "layer_type": "agent",
                                "items": [{"id": "after", "x": 5}],
                            }
                        ],
                    }
                ],
            },
        )
    )
    assert model.birds == {"after": {"id": "after", "x": 5}}
    assert scenario.environments["main"].layers["birds"].target is model
