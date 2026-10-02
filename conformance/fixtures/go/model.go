// Pure deterministic host model. Binding and sidecar I/O live in main.go.
package main

type Agent struct {
	ID     int    `json:"id"`
	X      int    `json:"x"`
	Y      int    `json:"y"`
	Health string `json:"health"`
}

type CounterModel struct {
	X              int     `json:"x"`
	Steps          int     `json:"steps"`
	RNG            int     `json:"rng"`
	Queue          []int   `json:"queue"`
	Speed          float64 `json:"speed"`
	Agents         []Agent `json:"agents"`
	NextID         int     `json:"next_id"`
	BasePopulation int     `json:"base_population"`
	Births         int     `json:"births"`
	Deaths         int     `json:"deaths"`
}

func NewCounterModel() *CounterModel {
	m := &CounterModel{RNG: 7, Queue: []int{1, 2, 3}, Speed: 1}
	m.seed(4)
	return m
}

func (m *CounterModel) Snapshot() CounterModel {
	copy := *m
	copy.Queue = append([]int(nil), m.Queue...)
	copy.Agents = append([]Agent{}, m.Agents...)
	return copy
}

func (m *CounterModel) Restore(saved CounterModel) {
	*m = saved
	m.Queue = append([]int(nil), saved.Queue...)
	m.Agents = append([]Agent(nil), saved.Agents...)
}

func (m *CounterModel) Step() {
	m.Steps++
	m.X += int(m.Speed)
	m.RNG = (m.RNG*17 + 11) % 997
	m.Queue = append(append([]int(nil), m.Queue[1:]...), m.Queue[0]+m.Steps)
	if len(m.Agents) == 0 {
		return
	}
	for index := range m.Agents {
		agent := &m.Agents[index]
		agent.X = (agent.X + 1 + agent.ID%3) % 64
		agent.Y = (agent.Y + 2) % 64
		if agent.Health == "I" && m.Steps%2 == 0 {
			agent.Health = "R"
		} else if agent.Health == "S" && agent.ID%5 == 0 && m.Steps%3 == 0 {
			agent.Health = "I"
		}
	}
	if m.Steps%3 == 0 {
		m.Agents = m.Agents[1:]
		m.Deaths++
	}
	if m.Steps%2 == 0 {
		m.Agents = append(m.Agents, m.newAgent())
		m.Births++
	}
}

func (m *CounterModel) SetSpeed(speed float64) {
	m.Speed = speed
}

func (m *CounterModel) newAgent() Agent {
	id := m.NextID
	m.NextID++
	health := "S"
	if id%4 == 1 {
		health = "I"
	}
	return Agent{ID: id, X: id % 64, Y: (id / 64) % 64, Health: health}
}

func (m *CounterModel) seed(count int) {
	m.Agents = make([]Agent, 0, count)
	m.BasePopulation = count
	m.Births, m.Deaths = 0, 0
	for range count {
		m.Agents = append(m.Agents, m.newAgent())
	}
}

func (m *CounterModel) SeedDense() {
	m.seed(1024)
}

func (m *CounterModel) ClearPopulation() {
	m.Agents = []Agent{}
	m.BasePopulation = 0
	m.Births, m.Deaths = 0, 0
}

func (m *CounterModel) Counts() (susceptible, infected, recovered int) {
	for _, agent := range m.Agents {
		switch agent.Health {
		case "S":
			susceptible++
		case "I":
			infected++
		case "R":
			recovered++
		}
	}
	return
}
