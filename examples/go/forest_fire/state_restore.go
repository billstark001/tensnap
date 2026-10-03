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

func decodeCellState(value any) (string, error) {
	state, ok := value.(string)
	if !ok || !cellState(state) {
		return "", fmt.Errorf("invalid forest-fire cell state: %v", value)
	}
	return state, nil
}

func restoreCellMatrix(m *Model, values [][]string) error {
	if len(values) != m.Height {
		return fmt.Errorf("forest-fire matrix height disagrees with the model")
	}
	cells := make([]string, 0, m.Width*m.Height)
	for _, row := range values {
		if len(row) != m.Width {
			return fmt.Errorf("forest-fire matrix width disagrees with the model")
		}
		cells = append(cells, row...)
	}
	m.Cells = cells
	return nil
}
