package main

import (
	"fmt"
	"math"

	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
)

func restoreTime(m *Model, time float64) error {
	if time < 0 || math.Trunc(time) != time {
		return fmt.Errorf("forest-fire time must be a nonnegative tick")
	}
	m.Tick = int(time)
	return nil
}

func validateGrid(m *Model, metadata map[string]any) error {
	width, widthOK := abm.AsFloat64(metadata["width"])
	height, heightOK := abm.AsFloat64(metadata["height"])
	if !widthOK || !heightOK || width != float64(m.Width) || height != float64(m.Height) {
		return fmt.Errorf("forest-fire grid dimensions disagree with the model")
	}
	return nil
}

func restoreCells(m *Model, items []map[string]any) error {
	if len(items) != len(m.Cells) {
		return fmt.Errorf("forest-fire restore requires every cell")
	}
	cells := make([]string, len(items))
	seen := make([]bool, len(items))
	for _, item := range items {
		id, ok := abm.AsFloat64(item["id"])
		if !ok || id < 0 || id >= float64(len(items)) || math.Trunc(id) != id || seen[int(id)] {
			return fmt.Errorf("invalid or duplicate cell ID: %v", item["id"])
		}
		x, xOK := abm.AsFloat64(item["x"])
		y, yOK := abm.AsFloat64(item["y"])
		if !xOK || !yOK || x != float64(int(id)%m.Width) || y != float64(int(id)/m.Width) {
			return fmt.Errorf("cell %v has noncanonical grid coordinates", id)
		}
		data, ok := item["data"].(map[string]any)
		if !ok {
			return fmt.Errorf("cell %v lacks state data", id)
		}
		state, ok := data["state"].(string)
		if !ok || !cellState(state) {
			return fmt.Errorf("invalid state for cell %v", id)
		}
		seen[int(id)] = true
		cells[int(id)] = state
	}
	m.Cells = cells
	return nil
}
