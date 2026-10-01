package main

import "fmt"

const (
	empty   = "empty"
	tree    = "tree"
	burning = "burning"
)

type Config struct {
	Width     int     `tensnap:"width,scope=space"`
	Height    int     `tensnap:"height,scope=space"`
	Growth    float64 `tensnap:"id=growth,label='Tree growth probability',min=0,max=1,step=0.001"`
	Lightning float64 `tensnap:"id=lightning,label='Lightning probability',min=0,max=1,step=0.0001"`
	Seed      uint32
}

type Snapshot struct {
	Config Config   `json:"config"`
	Cells  []string `json:"cells"`
	Tick   int      `json:"tick"`
	RNG    uint32   `json:"rng"`
}

type Model struct {
	Config
	Cells []string
	Tick  int
	rng   uint32
}

func DefaultConfig() Config {
	return Config{Width: 30, Height: 30, Growth: 0.03, Lightning: 0.0005, Seed: 7}
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
	m.rng = m.Seed
	m.Tick = 0
	m.Cells = make([]string, m.Width*m.Height)
	for i := range m.Cells {
		m.Cells[i] = empty
		if m.random() < 0.55 {
			m.Cells[i] = tree
		}
	}
}

func (m *Model) burningNeighbor(id int) bool {
	x, y := id%m.Width, id/m.Width
	return (x > 0 && m.Cells[id-1] == burning) ||
		(x+1 < m.Width && m.Cells[id+1] == burning) ||
		(y > 0 && m.Cells[id-m.Width] == burning) ||
		(y+1 < m.Height && m.Cells[id+m.Width] == burning)
}

// Step applies all cell transitions simultaneously. Burning trees become
// empty; trees ignite from a cardinal neighbor or lightning; empty sites grow.
func (m *Model) Step() {
	next := append([]string(nil), m.Cells...)
	for id, state := range m.Cells {
		switch state {
		case burning:
			next[id] = empty
		case tree:
			if m.burningNeighbor(id) || m.random() < m.Lightning {
				next[id] = burning
			}
		case empty:
			if m.random() < m.Growth {
				next[id] = tree
			}
		}
	}
	m.Cells = next
	m.Tick++
}

func (m *Model) Count(state string) int {
	n := 0
	for _, cell := range m.Cells {
		if cell == state {
			n++
		}
	}
	return n
}

func (m *Model) Snapshot() Snapshot {
	return Snapshot{Config: m.Config, Cells: append([]string(nil), m.Cells...), Tick: m.Tick, RNG: m.rng}
}

func (m *Model) Restore(state Snapshot) error {
	if state.Config.Width <= 0 || state.Config.Height <= 0 || state.Tick < 0 ||
		len(state.Cells) != state.Config.Width*state.Config.Height ||
		!probability(state.Config.Growth) || !probability(state.Config.Lightning) {
		return fmt.Errorf("invalid forest-fire checkpoint")
	}
	for _, cell := range state.Cells {
		if !cellState(cell) {
			return fmt.Errorf("invalid forest-fire cell state")
		}
	}
	m.Config, m.Cells, m.Tick, m.rng = state.Config, append([]string(nil), state.Cells...), state.Tick, state.RNG
	return nil
}

func probability(value float64) bool { return value >= 0 && value <= 1 }
func cellState(value string) bool    { return value == empty || value == tree || value == burning }
