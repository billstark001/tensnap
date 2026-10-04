package schelling

// This exact checkpoint supports the publication replay experiment. An ordinary
// teaching host can use a simpler projected scene restore for agents, parameters,
// and time; that approach need not preserve the RNG's position or the same future.

import (
	"fmt"
	"strconv"
)

// checkpoint is model-owned data; the binding owns the wire envelope.
type checkpoint struct {
	Config      Config `json:"config"`
	Cells       []Cell `json:"cells"`
	LastSwapped int    `json:"last_swapped"`
	StepCount   int    `json:"step_count"`
	RNGSeed     int64  `json:"rng_seed"`
	RNGDraws    string `json:"rng_draws"`
}

func (m *Model) captureCheckpoint() checkpoint {
	return checkpoint{
		Config: m.Config, Cells: append([]Cell(nil), m.Cells...),
		LastSwapped: m.LastSwapped, StepCount: m.StepCount,
		RNGSeed: m.rngSeed, RNGDraws: strconv.FormatUint(m.rngSource.draws, 10),
	}
}

func (m *Model) restoreCheckpoint(saved checkpoint) error {
	width, height := saved.Config.GridWidth, saved.Config.GridHeight
	if width <= 0 || height <= 0 || len(saved.Cells) != width*height || saved.StepCount < 0 || saved.LastSwapped < 0 {
		return fmt.Errorf("invalid Schelling checkpoint dimensions or clock")
	}
	draws, err := strconv.ParseUint(saved.RNGDraws, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid Schelling checkpoint RNG position")
	}
	seen := make(map[string]bool)
	for i, cell := range saved.Cells {
		if cell.X != i%width || cell.Y != i/width || cell.Group < 0 || cell.Group > 2 ||
			(cell.Group == 0) != (cell.AgentID == "") || (cell.AgentID != "" && seen[cell.AgentID]) {
			return fmt.Errorf("invalid Schelling checkpoint cell %d", i)
		}
		if cell.AgentID != "" {
			seen[cell.AgentID] = true
		}
	}
	m.Config = saved.Config
	m.Cells = append([]Cell(nil), saved.Cells...)
	m.LastSwapped = saved.LastSwapped
	m.StepCount = saved.StepCount
	m.Initialized = true
	m.SetSeed(saved.RNGSeed)
	for i := uint64(0); i < draws; i++ {
		m.rngSource.Int63()
	}
	m.rebuildTopologyCache(width, height)
	return nil
}
