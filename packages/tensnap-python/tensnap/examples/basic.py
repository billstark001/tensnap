

# tensnap/examples/basic.py
"""Basic example of TenSnap usage"""

import asyncio
import random
import math
from tensnap import TenSnapServer, Agent, GridEnvironment, parameter, button, chart


class BasicSimulation:
    """Basic simulation example"""
    
    def __init__(self):
        self.server = TenSnapServer()
        self.speed = 1.0
        self.num_agents = 10
        self.running = False
        
        # Create grid environment
        self.grid = GridEnvironment(id="main", width=20, height=20)
        
        # Initialize agents
        for i in range(self.num_agents):
            agent = Agent(
                id=f"agent_{i}",
                x=random.randint(0, 19),
                y=random.randint(0, 19),
                heading=random.random() * 2 * math.pi,
                color=f"#{random.randint(0, 0xFFFFFF):06x}",
                icon="arrow"
            )
            self.grid.add_agent(agent)
            
        self.server.add_environment(self.grid)
        
        # Register parameters and buttons
        self._register_controls()
        
    def _register_controls(self):
        """Register all controls with the server"""
        # Find all methods with decorators
        for name in dir(self):
            attr = getattr(self, name)
            if hasattr(attr, '_tensnap_parameter'):
                param = attr._tensnap_parameter
                self.server.add_parameter(param)
                if hasattr(attr, '_tensnap_button_action'):
                    self.server.register_button(attr._tensnap_button_action, attr)
            elif hasattr(attr, '_tensnap_chart'):
                chart = attr._tensnap_chart
                self.server.add_chart(chart)
    
    @parameter("speed", "Movement Speed", min=0.1, max=5.0, step=0.1, default=1.0)
    def set_speed(self, value: float):
        """Set agent movement speed"""
        self.speed = value
        
    @parameter("num_agents", "Number of Agents", min=1, max=50, step=1, default=10)
    def set_num_agents(self, value: int):
        """Set number of agents"""
        diff = value - self.num_agents
        if diff > 0:
            # Add agents
            for i in range(diff):
                agent = Agent(
                    id=f"agent_{self.num_agents + i}",
                    x=random.randint(0, 19),
                    y=random.randint(0, 19),
                    heading=random.random() * 2 * math.pi,
                    color=f"#{random.randint(0, 0xFFFFFF):06x}",
                    icon="arrow"
                )
                self.grid.add_agent(agent)
        elif diff < 0:
            # Remove agents
            for i in range(-diff):
                if self.grid.agents:
                    self.grid.agents.pop()
                    
        self.num_agents = value
        
    @button("start_stop", "Start/Stop")
    def toggle_simulation(self):
        """Toggle simulation running state"""
        self.running = not self.running
        
    @button("reset", "Reset")
    def reset_simulation(self):
        """Reset simulation to initial state"""
        self.running = False
        for agent in self.grid.agents:
            agent.x = random.randint(0, 19)
            agent.y = random.randint(0, 19)
            agent.heading = random.random() * 2 * math.pi
            
    @chart("agent_count", "Active Agents")
    def get_agent_count(self) -> float:
        """Get current number of agents"""
        return len(self.grid.agents)
        
    async def step(self):
        """Execute one simulation step"""
        if not self.running:
            return
            
        # Move agents
        for agent in self.grid.agents:
            # Random walk
            agent.heading += (random.random() - 0.5) * 0.5
            
            # Calculate new position
            dx = math.cos(agent.heading) * self.speed
            dy = math.sin(agent.heading) * self.speed
            
            new_x = agent.x + dx
            new_y = agent.y + dy
            
            # Wrap around boundaries
            agent.x = new_x % 20
            agent.y = new_y % 20
            
            # Update on server
            await self.server.update_agent(
                "main", 
                agent.id,
                {"x": agent.x, "y": agent.y, "heading": agent.heading}
            )
            
    async def run(self):
        """Run the simulation"""
        server_task = asyncio.create_task(self.server.run())
        
        time_step = 0
        try:
            while True:
                await self.server.start_time_step(time_step)
                await self.step()
                await self.server.end_time_step()
                
                time_step += 1
                await asyncio.sleep(0.1)  # 10 FPS
                
        except KeyboardInterrupt:
            print("\nStopping simulation...")
        finally:
            self.server.stop()
            await server_task


if __name__ == "__main__":
    sim = BasicSimulation()
    asyncio.run(sim.run())