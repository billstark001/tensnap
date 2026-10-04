package schelling

// Publication audit sidecar; not part of the teaching Schelling example.
// The server injects this callback only when the audit environment variable is set.

import (
	"encoding/json"
	"os"
	"strconv"
)

// auditState reads live model fields without using captureCheckpoint.
func auditState(m *Model) any {
	cells := make([]map[string]any, len(m.Cells))
	for i, cell := range m.Cells {
		cells[i] = map[string]any{"id": cell.AgentID, "group": cell.Group, "x": cell.X, "y": cell.Y}
	}
	return map[string]any{
		"time": m.StepCount,
		"state": map[string]any{
			"cells": cells, "gridWidth": m.Config.GridWidth, "gridHeight": m.Config.GridHeight,
			"density": m.Config.Density, "balance": m.Config.Balance,
			"similarityThreshold": m.Config.SimilarityThreshold,
			"rng_seed":            m.rngSeed, "rng_draws": strconv.FormatUint(m.rngSource.draws, 10),
			"last_swapped": m.LastSwapped,
		},
		"metrics": map[string]any{
			"satisfaction_rate": m.SatisfiedPct(), "segregation_index": m.SegregationIndex(),
			"moved": m.LastSwapped, "population": len(occupiedCells(m)),
		},
	}
}

func auditWriter(path string) func(*Model) {
	if path == "" {
		return nil
	}
	return func(model *Model) {
		data, err := json.Marshal(auditState(model))
		if err != nil {
			panic(err)
		}
		if err := os.WriteFile(path+".tmp", data, 0600); err != nil {
			panic(err)
		}
		if err := os.Rename(path+".tmp", path); err != nil {
			panic(err)
		}
	}
}
