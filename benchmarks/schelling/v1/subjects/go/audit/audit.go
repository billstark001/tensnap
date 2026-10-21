package audit

// Publication audit sidecar; not part of the teaching Schelling example.
// The server injects this callback only when the audit environment variable is set.

import (
	"encoding/json"
	"fmt"
	shared "github.com/billstark001/tensnap/examples/go/internal/schelling"
	"os"
	"strconv"
)

// auditState reads live model fields without using captureCheckpoint.
func auditState(m *shared.Model) any {
	seed, draws := m.RNGPosition()
	cells := make([]map[string]any, len(m.Cells))
	for i, cell := range m.Cells {
		cells[i] = map[string]any{"id": cell.AgentID, "group": cell.Group, "x": cell.X, "y": cell.Y}
	}
	occupiedCells := []shared.Cell{}
	for _, cell := range m.Cells {
		if cell.Group != 0 {
			occupiedCells = append(occupiedCells, cell)
		}
	}
	return map[string]any{
		"time": m.StepCount,
		"state": map[string]any{
			"seed":  m.Config.Seed,
			"cells": cells, "gridWidth": m.Config.GridWidth, "gridHeight": m.Config.GridHeight,
			"density": m.Config.Density, "balance": m.Config.Balance,
			"similarityThreshold": m.Config.SimilarityThreshold,
			"rng_seed":            seed, "rng_draws": strconv.FormatUint(draws, 10),
			"last_swapped": m.LastSwapped,
		},
		"metrics": map[string]any{
			"satisfaction_rate": m.SatisfiedPct(), "segregation_index": m.SegregationIndex(),
			"moved": m.LastSwapped, "population": len(occupiedCells),
		},
	}
}

func Writer(path string) func(*shared.Model) error {
	return func(model *shared.Model) error {
		data, err := json.Marshal(auditState(model))
		if err != nil {
			return fmt.Errorf("write Schelling audit: %w", err)
		}
		if err := os.WriteFile(path+".tmp", data, 0600); err != nil {
			return fmt.Errorf("write Schelling audit: %w", err)
		}
		if err := os.Rename(path+".tmp", path); err != nil {
			return fmt.Errorf("write Schelling audit: %w", err)
		}
		return nil
	}
}
