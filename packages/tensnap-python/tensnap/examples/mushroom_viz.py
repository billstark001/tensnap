# tensnap/examples/mushroom_viz.py
"""TenSnap visualization for the mushroom foraging simulation"""

import asyncio
import os
from typing import List
from tensnap import (
    TenSnapServer,
    AgentModel,
    GridEnvironmentModel,
)
from tensnap.simulation import SimulationManager
from tensnap.bindings.basic import chart, button, quick_bind

# 导入纯仿真逻辑
from .mushroom import ForagingModel, Hunter, Patch

# 全局状态
server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
server = TenSnapServer(port=server_port)
grid = GridEnvironmentModel(id="main", width=50, height=50)
agents: List[AgentModel] = []
config = {
    "width": 50,
    "height": 50,
    "num_clusters": 4,
    "patches_per_cluster": 20,
    "num_turtles": 2,
}
simulation = None
sim_manager = SimulationManager(step_interval=0.1)
time_step = 0

# 绑定参数（可扩展）
bound_params = quick_bind(target=config)

# 控制按钮
def get_found_count():
    """统计已找到蘑菇的数量"""
    if simulation is None or not hasattr(simulation, "patch_grid"):
        return 0
    count = 0
    for x in range(config["width"]):
        for y in range(config["height"]):
            patch = simulation.patch_grid[x][y]
            if hasattr(patch, "color") and patch.color == "yellow":
                count += 1
    return count

@button("start_stop", "Start/Stop")
async def toggle() -> None:
    await sim_manager.toggle(time_step)

@button("reset", "Reset")
async def reset() -> None:
    await sim_manager.reset(init_simulation)

@chart("found_mushrooms", "Found Mushrooms", color="#F39C12")
def found_mushrooms_chart() -> int:
    return get_found_count()

@chart("avg_search_time", "Avg Search Time", color="#2980B9")
def avg_search_time_chart() -> float:
    if simulation is None:
        return 0.0
    # 获取所有 Hunter 实例
    hunters = [agent for agent in getattr(simulation, "_agents", []) if isinstance(agent, Hunter)]
    if not hunters:
        return 0.0
    # 只统计有 time_since_last_found 属性的 Hunter
    times = [getattr(h, "time_since_last_found", 0) for h in hunters]
    return sum(times) / len(times) if times else 0.0

# 初始化仿真
def init_simulation() -> None:
    global agents, time_step, simulation
    time_step = 0
    agents.clear()
    grid.agents.clear()
    simulation = ForagingModel(**config)

    # 添加 Patch
    if hasattr(simulation, "patch_grid"):
        for x in range(config["width"]):
            for y in range(config["height"]):
                patch = simulation.patch_grid[x][y]
                color = "#E74C3C" if getattr(patch, "color", "white") == "red" else ("#F7CA18" if getattr(patch, "color", "white") == "yellow" else "#ECF0F1")
                agent = AgentModel(
                    id=f"patch_{x}_{y}",
                    x=x,
                    y=y,
                    color=color,
                    size=6,
                    icon="circle",
                    update_source=patch,
                )
                agents.append(agent)
                grid.add_agent(agent)

    # 添加 Hunter
    hunters = [agent for agent in getattr(simulation, "_agents", []) if isinstance(agent, Hunter)]
    for hunter in hunters:
        pos = getattr(hunter, "pos", (0, 0))
        # pos 可能不是 tuple，做类型检查
        if isinstance(pos, tuple) and len(pos) == 2:
            x, y = pos
        else:
            x, y = 0, 0
        agent = AgentModel(
            id=f"hunter_{id(hunter)}",
            x=x,
            y=y,
            color="#F9E79F",
            size=10,
            icon="arrow",
            update_source=hunter,
        )
        agents.append(agent)
        grid.add_agent(agent)

# 仿真步进
def simulation_step() -> None:
    global time_step
    if not simulation:
        return
    simulation.step()
    time_step += 1

# 单步按钮
@button("step", "Evolve 1 Step")
async def simulation_step_btn() -> None:
    await server.start_time_step(time_step)
    simulation_step()
    updates = grid.generate_agent_updates()
    await server.update_agents_batch("main", updates)
    await server.end_time_step()

# 主函数
async def main() -> None:
    sim_manager.on_start = init_simulation
    sim_manager.on_step = simulation_step_btn
    init_simulation()
    server.add_environment(grid)
    for param in bound_params:
        server.add_parameter(param)
    server.auto_register_from_globals(globals())
    print(f"TenSnap Mushroom Visualization starting on ws://localhost:{server_port}")
    await server.run()

if __name__ == "__main__":
    asyncio.run(main())
