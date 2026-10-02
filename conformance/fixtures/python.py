"""Deterministic Python binding host for the cross-binding wire probe."""

import asyncio
import json
import os
from pathlib import Path

from tensnap import agent, agent_layer, chart, env, grid_layer
from tensnap.bindings import BindParameterConfig, action, monitor
from tensnap.scenario import SimulationScenario


STATE_PATH = Path(os.environ["TENSNAP_CONFORMANCE_STATE"])


@agent(x="x", y="y", color="color", data="data")
class Agent:
    def __init__(self, agent_id: int, x: int, y: int, health: str):
        self.id, self.x, self.y, self.health = agent_id, x, y, health

    @property
    def color(self):
        return {"S": "#3498db", "I": "#e74c3c", "R": "#2ecc71"}[self.health]

    @property
    def data(self):
        return {"health": self.health}

    def snapshot(self):
        return {"id": self.id, "x": self.x, "y": self.y, "health": self.health}


@env(id="study")
@grid_layer(width="width", height="height")
@agent_layer("agents", item_iterable_projector="agents")
class Model:
    def __init__(self):
        self.x = 0
        self.steps = 0
        self.rng = 7
        self.queue = [1, 2, 3]
        self._speed = 1
        self.width = self.height = 64
        self.agents: list[Agent] = []
        self.next_id = 0
        self.base_population = 0
        self.births = self.deaths = 0
        self.publish = None
        self.seed(4)

    def new_agent(self):
        agent_id = self.next_id
        self.next_id += 1
        return Agent(agent_id, agent_id % 64, (agent_id // 64) % 64,
                     "I" if agent_id % 4 == 1 else "S")

    def seed(self, count: int):
        self.agents = []
        self.base_population = count
        self.births = self.deaths = 0
        for _ in range(count):
            self.agents.append(self.new_agent())

    def counts(self):
        return {key: sum(agent.health == key for agent in self.agents)
                for key in ("S", "I", "R")}

    def snapshot(self):
        return {
            "x": self.x,
            "steps": self.steps,
            "rng": self.rng,
            "queue": list(self.queue),
            "speed": self._speed,
            "agents": [agent.snapshot() for agent in self.agents],
            "next_id": self.next_id,
            "base_population": self.base_population,
            "births": self.births,
            "deaths": self.deaths,
        }

    def persist(self):
        STATE_PATH.write_text(json.dumps(self.snapshot(), sort_keys=True))

    @BindParameterConfig("number", id="speed", min=0, max=5, step=1)
    def speed(self):
        return self._speed

    @speed.setter
    def speed(self, value):
        self._speed = max(0, min(5, int(value)))
        self.persist()

    @monitor("position", "Position")
    def position(self):
        return self.x

    @monitor("population", "Population")
    def population(self):
        return len(self.agents)

    @chart("health", "Health states", data_list=[
        {"id": "susceptible", "label": "Susceptible", "color": "#3498db"},
        {"id": "infected", "label": "Infected", "color": "#e74c3c"},
        {"id": "recovered", "label": "Recovered", "color": "#2ecc71"},
    ])
    def health_chart(self):
        counts = self.counts()
        return {"susceptible": counts["S"], "infected": counts["I"], "recovered": counts["R"]}

    def step(self):
        self.steps += 1
        self.x += self._speed
        self.rng = (self.rng * 17 + 11) % 997
        self.queue = self.queue[1:] + [self.queue[0] + self.steps]
        if self.agents:
            for agent in self.agents:
                agent.x = (agent.x + 1 + agent.id % 3) % 64
                agent.y = (agent.y + 2) % 64
                if agent.health == "I" and self.steps % 2 == 0:
                    agent.health = "R"
                elif agent.health == "S" and agent.id % 5 == 0 and self.steps % 3 == 0:
                    agent.health = "I"
            if self.steps % 3 == 0:
                self.agents.pop(0)
                self.deaths += 1
            if self.steps % 2 == 0:
                self.agents.append(self.new_agent())
                self.births += 1
        self.persist()
        return True

    @action("fail", "Fail")
    def fail(self):
        raise RuntimeError("intentional handler failure")

    @action("seed_dense", "Seed Dense Population")
    async def seed_dense(self):
        self.seed(1024)
        self.persist()
        await self.publish()

    @action("clear_population", "Clear Population")
    async def clear_population(self):
        self.agents = []
        self.base_population = self.births = self.deaths = 0
        self.persist()
        await self.publish()

    def restore(self, saved):
        self.x = int(saved["x"])
        self.steps = int(saved["steps"])
        self.rng = int(saved["rng"])
        self.queue = list(saved["queue"])
        self._speed = int(saved["speed"])
        self.agents = [Agent(int(agent["id"]), int(agent["x"]), int(agent["y"]), str(agent["health"]))
                       for agent in saved["agents"]]
        self.next_id = int(saved["next_id"])
        self.base_population = int(saved["base_population"])
        self.births = int(saved["births"])
        self.deaths = int(saved["deaths"])
        self.persist()


async def main():
    model = Model()
    model.persist()
    checkpoint_options = (
        {}
        if os.environ.get("TENSNAP_CONFORMANCE_NO_CHECKPOINT") == "1"
        else {"checkpoint_capture": model.snapshot, "checkpoint_restore": model.restore}
    )
    scenario = SimulationScenario(
        host="127.0.0.1",
        port=int(os.environ["TENSNAP_CONFORMANCE_PORT"]),
        model_id="conformance.counter",
        state_schema_version="1",
        scene_restore=lambda _payload: None,
        **checkpoint_options,
    )
    scenario.add_all(model)
    await scenario.register_model_handler(model_step=model.step)
    async def publish():
        await scenario._handlers[0]._push_env_updates()
        await scenario.broadcast_charts(scenario._time_step)
        await scenario.broadcast_monitors()
    model.publish = publish
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
