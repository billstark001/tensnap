package main

import (
	"fmt"
	"math"

	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
)

func restoreTime(m *Model, time float64) error {
	if time < 0 || math.Trunc(time) != time {
		return fmt.Errorf("SIRS time must be a nonnegative tick")
	}
	m.Tick = int(time)
	return nil
}

func validateGrid(m *Model, metadata map[string]any) error {
	width, widthOK := abm.AsFloat64(metadata["width"])
	height, heightOK := abm.AsFloat64(metadata["height"])
	if !widthOK || !heightOK || width != float64(m.Cols) || height != float64(m.Rows) {
		return fmt.Errorf("SIRS grid dimensions disagree with the model")
	}
	return nil
}

func restorePeople(m *Model, items []map[string]any) error {
	if len(items) != len(m.People) {
		return fmt.Errorf("SIRS restore requires every grid person")
	}
	people := make([]Person, len(items))
	seen := make([]bool, len(items))
	for _, item := range items {
		id, ok := abm.AsFloat64(item["id"])
		if !ok || id < 0 || id >= float64(len(items)) || math.Trunc(id) != id || seen[int(id)] {
			return fmt.Errorf("invalid or duplicate person ID: %v", item["id"])
		}
		x, xOK := abm.AsFloat64(item["x"])
		y, yOK := abm.AsFloat64(item["y"])
		if !xOK || !yOK || x != float64(int(id)%m.Cols) || y != float64(int(id)/m.Cols) {
			return fmt.Errorf("person %v has noncanonical grid coordinates", id)
		}
		data, ok := item["data"].(map[string]any)
		if !ok {
			return fmt.Errorf("person %v lacks health state", id)
		}
		state, ok := data["state"].(string)
		if !ok || !healthState(state) {
			return fmt.Errorf("invalid health state for person %v", id)
		}
		seen[int(id)] = true
		people[int(id)] = Person{ID: int(id), State: state}
	}
	m.People = people
	return nil
}
