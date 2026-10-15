package abm

import (
	"fmt"
	"math"
	"reflect"
	"testing"
)

func TestNaiveItemDiffTrackerCompoundKeys(t *testing.T) {
	tracker := NewNaiveItemDiffTracker("source", "target")
	items := []ItemSnapshot{
		{"source": 1, "target": 2},
		{"source": "1", "target": "2"},
		{"source": "a\x00b", "target": "c"},
		{"source": "a", "target": "b\x00c"},
	}
	created, _, _ := tracker.Compute(items)
	if len(created) != 4 {
		t.Fatalf("created %d items, want 4", len(created))
	}
	_, updated, deleted := tracker.Compute(items[1:])
	if len(updated) != 0 || !reflect.DeepEqual(deleted, []any{map[string]any{"source": 1, "target": 2}}) {
		t.Fatalf("updated=%v deleted=%v", updated, deleted)
	}
	for _, item := range items[1:] {
		item["color"] = "red"
	}
	_, updated, _ = tracker.Compute(items[1:])
	if len(updated) != 3 {
		t.Fatalf("updated %d items, want 3", len(updated))
	}
}

func FuzzNaiveItemDiffTrackerCompoundKeys(f *testing.F) {
	f.Add("a\x00b", "c", "a", "b\x00c")
	f.Add("a", "b", "a", "b")
	f.Fuzz(func(t *testing.T, a, b, c, d string) {
		tracker := NewNaiveItemDiffTracker("source", "target")
		items := []ItemSnapshot{{"source": a, "target": b}, {"source": c, "target": d}}
		if a == c && b == d {
			items = items[:1]
		}
		created, _, _ := tracker.Compute(items)
		if len(created) != len(items) {
			t.Fatalf("compound keys collided: %q/%q and %q/%q", a, b, c, d)
		}
		_, updated, deleted := tracker.Compute(items[:1])
		if len(updated) != 0 || len(deleted) != len(items)-1 {
			t.Fatalf("updated=%v deleted=%v", updated, deleted)
		}
	})
}

func BenchmarkNaiveItemDiffTrackerCompoundKeys(b *testing.B) {
	for _, count := range []int{100, 1000, 10000} {
		b.Run(fmt.Sprint(count), func(b *testing.B) {
			items := make([]ItemSnapshot, count)
			for index := range items {
				items[index] = ItemSnapshot{"source": index, "target": index + 1}
			}
			tracker := NewNaiveItemDiffTracker("source", "target")
			tracker.Seed(items)
			b.ReportAllocs()
			b.ResetTimer()
			for index := 0; index < b.N; index++ {
				tracker.Compute(items)
			}
		})
	}
}

func TestDictDiffNestedData(t *testing.T) {
	previous := ItemSnapshot{"id": 1, "data": map[string]any{"state": "susceptible"}}
	if diff := DictDiff(previous, ItemSnapshot{"id": 1, "data": map[string]any{"state": "susceptible"}}); diff != nil {
		t.Fatalf("unchanged nested data produced diff: %v", diff)
	}
	want := ItemSnapshot{"data": map[string]any{"state": "infected"}}
	if diff := DictDiff(previous, ItemSnapshot{"id": 1, "data": map[string]any{"state": "infected"}}); !reflect.DeepEqual(diff, want) {
		t.Fatalf("diff = %v, want %v", diff, want)
	}
}

func TestNaiveItemDiffTrackerOwnsKeyFieldDeclaration(t *testing.T) {
	fields := []string{"id"}
	tracker := NewNaiveItemDiffTracker(fields...)
	tracker.Seed([]ItemSnapshot{{"id": 1, "x": 2}})
	fields[0] = "x"
	created, updated, deleted := tracker.Compute([]ItemSnapshot{{"id": 1, "x": 3}})
	if len(created) != 0 || len(deleted) != 0 || !reflect.DeepEqual(updated, []ItemSnapshot{{"id": 1, "x": 3}}) {
		t.Fatalf("caller mutation changed the declared key: created=%v updated=%v deleted=%v", created, updated, deleted)
	}
}

func TestDiffTrackersRejectNonFiniteNumericKeys(t *testing.T) {
	type NumericID float64
	for _, key := range []any{math.NaN(), math.Inf(1), math.Inf(-1), float32(math.NaN()), float32(math.Inf(1)), NumericID(math.NaN())} {
		for _, operation := range []string{"precise-seed", "precise-compute", "naive-seed", "naive-compute", "compound-compute"} {
			t.Run(fmt.Sprintf("%T/%v/%s", key, key, operation), func(t *testing.T) {
				defer func() {
					if recovered := recover(); recovered != "abm: numeric item keys must be finite" {
						t.Fatalf("expected a finite-key diagnostic, got %v", recovered)
					}
				}()
				item := ItemSnapshot{"id": key, "source": key, "target": "peer"}
				precise := NewItemDiffTracker[ItemSnapshot]()
				id := func(item ItemSnapshot) any { return item["id"] }
				project := func(item ItemSnapshot) ItemSnapshot { return item }
				switch operation {
				case "precise-seed":
					precise.Seed([]ItemSnapshot{item}, id, project)
				case "precise-compute":
					precise.Compute([]ItemSnapshot{item}, id, func(ItemSnapshot) bool { return true }, project)
				case "naive-seed":
					NewNaiveItemDiffTracker("id").Seed([]ItemSnapshot{item})
				case "naive-compute":
					NewNaiveItemDiffTracker("id").Compute([]ItemSnapshot{item})
				case "compound-compute":
					NewNaiveItemDiffTracker("source", "target").Compute([]ItemSnapshot{item})
				}
			})
		}
	}
}

func TestDiffTrackersClearOmittedFieldsAndDetectReintroduction(t *testing.T) {
	for _, precise := range []bool{false, true} {
		t.Run(fmt.Sprint(precise), func(t *testing.T) {
			item := ItemSnapshot{"id": 1, "color": "red", "x": 1}
			preciseTracker := NewItemDiffTracker[ItemSnapshot]()
			naiveTracker := NewNaiveItemDiffTracker("id")
			compute := func() []ItemSnapshot {
				if precise {
					_, updates, _ := preciseTracker.Compute([]ItemSnapshot{item}, func(item ItemSnapshot) any { return item["id"] }, func(ItemSnapshot) bool { return true }, func(item ItemSnapshot) ItemSnapshot { return item })
					return updates
				}
				_, updates, _ := naiveTracker.Compute([]ItemSnapshot{item})
				return updates
			}
			compute()
			delete(item, "color")
			if updates := compute(); !reflect.DeepEqual(updates, []ItemSnapshot{{"id": 1, "color": nil}}) {
				t.Fatalf("field deletion: %v", updates)
			}
			if updates := compute(); len(updates) != 0 {
				t.Fatalf("unchanged deletion: %v", updates)
			}
			item["color"] = "red"
			if updates := compute(); !reflect.DeepEqual(updates, []ItemSnapshot{{"id": 1, "color": "red"}}) {
				t.Fatalf("field reintroduction: %v", updates)
			}
		})
	}
	if diff := DictDiff(ItemSnapshot{"color": "red"}, ItemSnapshot{}); diff != nil {
		t.Fatalf("partial-map DictDiff contract changed: %v", diff)
	}
}
