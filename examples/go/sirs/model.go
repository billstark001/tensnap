package main

import "fmt"

const (
	susceptible = "S"
	infected    = "I"
	recovered   = "R"
)

// Config matches the Python grid SIRS example: beta, gamma, xi, the number
// initially infected, and grid dimensions. Seed makes reset reproducible.
type Config struct {
	Beta            float64 `tensnap:"id=beta,label='Infection rate',min=0,max=1,step=0.1"`
	Gamma           float64 `tensnap:"id=gamma,label='Recovery rate',min=0,max=1,step=0.1"`
	Xi              float64 `tensnap:"id=xi,label='Loss of immunity rate',min=0,max=1,step=0.1"`
	InitialInfected int     `tensnap:"id=initial_infected,label='Initial infected',min=0,max=10000,step=1,fixed=true"`
	Rows            int     `tensnap:"id=rows,label='Grid rows',min=1,max=10000,step=1,fixed=true; height,scope=space"`
	Cols            int     `tensnap:"id=cols,label='Grid columns',min=1,max=10000,step=1,fixed=true; width,scope=space"`
	Seed            uint32
}

type Person struct {
	ID    int    `json:"id" tensnap:"id"`
	State string `json:"state" tensnap:"state,scope=data"`
}

type Snapshot struct {
	Config Config   `json:"config"`
	People []Person `json:"people"`
	Tick   int      `json:"tick"`
	RNG    uint32   `json:"rng"`
}

type Model struct {
	Config
	People []Person
	Tick   int
	rng    uint32
}

func DefaultConfig() Config {
	return Config{Rows: 40, Cols: 40, Beta: 0.3, Gamma: 0.1, Xi: 0.05, InitialInfected: 5, Seed: 7}
}

func NewModel(config Config) *Model {
	m := &Model{Config: config}
	m.Reset()
	return m
}

func (m *Model) random() float64 {
	m.rng = m.rng*1664525 + 1013904223
	return float64(m.rng) / 4294967296
}

func (m *Model) Reset() {
	n := m.Rows * m.Cols
	m.People = make([]Person, n)
	for id := range m.People {
		m.People[id] = Person{ID: id, State: susceptible}
	}
	m.rng = m.Seed
	// Sample without replacement, as in the Python model.
	indices := make([]int, n)
	for i := range indices {
		indices[i] = i
	}
	for i := 0; i < m.InitialInfected && i < n; i++ {
		j := i + int(m.random()*float64(n-i))
		indices[i], indices[j] = indices[j], indices[i]
		m.People[indices[i]].State = infected
	}
	m.Tick = 0
}

func (m *Model) neighbors(id int) []int {
	row, col := id/m.Cols, id%m.Cols
	result := make([]int, 0, 4)
	if row > 0 {
		result = append(result, id-m.Cols)
	}
	if row+1 < m.Rows {
		result = append(result, id+m.Cols)
	}
	if col > 0 {
		result = append(result, id-1)
	}
	if col+1 < m.Cols {
		result = append(result, id+1)
	}
	return result
}

func (m *Model) Step() {
	next := append([]Person(nil), m.People...)
	for id, p := range m.People {
		switch p.State {
		case susceptible:
			for _, other := range m.neighbors(id) {
				if m.People[other].State == infected && m.random() < m.Beta {
					next[id].State = infected
					break
				}
			}
		case infected:
			if m.random() < m.Gamma {
				next[id].State = recovered
			}
		case recovered:
			if m.random() < m.Xi {
				next[id].State = susceptible
			}
		}
	}
	m.People = next
	m.Tick++
}

func (m *Model) Counts() (int, int, int) {
	s, i, r := 0, 0, 0
	for _, p := range m.People {
		switch p.State {
		case susceptible:
			s++
		case infected:
			i++
		case recovered:
			r++
		}
	}
	return s, i, r
}

func (m *Model) Snapshot() Snapshot {
	return Snapshot{Config: m.Config, People: append([]Person(nil), m.People...), Tick: m.Tick, RNG: m.rng}
}

func (m *Model) Restore(state Snapshot) error {
	if state.Config.Rows <= 0 || state.Config.Cols <= 0 || state.Tick < 0 ||
		len(state.People) != state.Config.Rows*state.Config.Cols ||
		state.Config.InitialInfected < 0 ||
		!probability(state.Config.Beta) || !probability(state.Config.Gamma) || !probability(state.Config.Xi) {
		return fmt.Errorf("invalid SIRS checkpoint")
	}
	for id, p := range state.People {
		if p.ID != id || !healthState(p.State) {
			return fmt.Errorf("invalid SIRS person %d", id)
		}
	}
	m.Config, m.People, m.Tick, m.rng = state.Config, append([]Person(nil), state.People...), state.Tick, state.RNG
	return nil
}

func probability(value float64) bool { return value >= 0 && value <= 1 }
func healthState(value string) bool {
	return value == susceptible || value == infected || value == recovered
}
