package abm

import (
	"maps"
	"reflect"
	"slices"
	"testing"
)

// Replaying scalar item deltas must reconstruct the complete current projection,
// including field removals, identity deletion, and reintroduction with old values.
func FuzzNaiveItemDiffTrackerReplay(f *testing.F) {
	f.Add([]byte{0, 2, 3, 2, 1, 4, 5, 6, 7, 16, 18, 19})
	f.Fuzz(func(t *testing.T, operations []byte) {
		if len(operations) > 4096 {
			t.Skip()
		}
		tracker := NewNaiveItemDiffTracker("id")
		model := map[int]ItemSnapshot{}
		rendered := map[int]ItemSnapshot{}
		for _, operation := range operations {
			id := int(operation >> 4)
			kind := operation & 7
			if kind == 1 {
				delete(model, id)
			} else {
				item := model[id]
				if item == nil {
					item = ItemSnapshot{"id": id}
					model[id] = item
				}
				switch kind {
				case 0:
					item["x"] = int(operation)
				case 2:
					item["color"] = "red"
				case 3:
					delete(item, "color")
				case 4:
					item["data"] = true
				case 5:
					item["data"] = false
				case 6:
					delete(item, "data")
				case 7:
					delete(item, "x")
				}
			}
			ids := make([]int, 0, len(model))
			for id := range model {
				ids = append(ids, id)
			}
			slices.Sort(ids)
			projected := make([]ItemSnapshot, 0, len(ids))
			for _, id := range ids {
				projected = append(projected, model[id])
			}
			created, updated, deleted := tracker.Compute(projected)
			for _, key := range deleted {
				delete(rendered, key.(int))
			}
			for _, item := range created {
				rendered[item["id"].(int)] = maps.Clone(item)
			}
			for _, update := range updated {
				item := rendered[update["id"].(int)]
				if item == nil {
					t.Fatal("update for an absent item")
				}
				for field, value := range update {
					if value == nil {
						delete(item, field)
					} else {
						item[field] = value
					}
				}
			}
			if !reflect.DeepEqual(model, rendered) {
				t.Fatalf("delta replay diverged after operation %d: model=%v rendered=%v", operation, model, rendered)
			}
		}
	})
}
