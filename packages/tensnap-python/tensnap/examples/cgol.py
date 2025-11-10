from typing import cast
import mesa

class Cell(mesa.Agent):
    model: 'GameOfLife'
    pos: 'tuple[int, int]'
    
    def __init__(self, model: 'GameOfLife', pos: 'tuple[int, int]'):
        super().__init__(model)
        self.pos = pos
        self.alive: bool = self.random.choice([True, False])
        self.next_state = None
    
    def step(self):
        neighbors = self.model.grid.get_neighbors(self.pos, moore=True)
        alive_neighbors = sum(cast('Cell', n).alive for n in neighbors)
        
        if self.alive:
            self.next_state = alive_neighbors in [2, 3]
        else:
            self.next_state = alive_neighbors == 3
    
    def advance(self):
        self.alive = self.next_state or False


class GameOfLife(mesa.Model):
    def __init__(self, width=50, height=50, seed=None):
        super().__init__(seed=seed)
        self.grid = mesa.space.SingleGrid(width, height, torus=True)
        
        for x in range(width):
            for y in range(height):
                cell = Cell(self, (x, y))
                self.grid.place_agent(cell, (x, y))
        
        self.datacollector = mesa.DataCollector(
            model_reporters={"Alive": lambda m: sum(a.alive for a in m.agents)}
        )
    
    def step(self):
        self.agents.do("step")
        self.agents.do("advance")
        self.datacollector.collect(self)

