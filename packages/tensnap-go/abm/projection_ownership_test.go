package abm

import (
	"reflect"
	"sync"
	"testing"
)

func TestDiffTrackersDetectInPlaceNestedMutation(t *testing.T) {
	for _, precise := range []bool{false, true} {
		t.Run(map[bool]string{false: "naive", true: "precise"}[precise], func(t *testing.T) {
			data := map[string]any{"values": []any{map[string]any{"count": 0}}}
			item := ItemSnapshot{"id": "a", "data": data}
			items := []ItemSnapshot{item}
			naive := NewNaiveItemDiffTracker("id")
			tracker := NewItemDiffTracker[ItemSnapshot]()
			id := func(item ItemSnapshot) any { return item["id"] }
			project := func(item ItemSnapshot) ItemSnapshot { return item }
			compute := func() ([]ItemSnapshot, []ItemSnapshot, []any) {
				if precise {
					return tracker.Compute(items, id, func(ItemSnapshot) bool { return true }, project)
				}
				return naive.Compute(items)
			}
			if precise {
				tracker.Seed(items, id, project)
			} else {
				naive.Seed(items)
			}
			data["values"].([]any)[0].(map[string]any)["count"] = 1
			_, updates, _ := compute()
			if len(updates) != 1 {
				t.Fatalf("nested mutation produced %d updates", len(updates))
			}
			saved := updates[0]["data"].(map[string]any)["values"].([]any)[0].(map[string]any)
			data["values"].([]any)[0].(map[string]any)["count"] = 2
			if saved["count"] != 1 {
				t.Fatal("later model mutation rewrote a published update")
			}
			_, next, _ := compute()
			if len(next) != 1 {
				t.Fatal("next nested mutation was hidden by an aliased baseline")
			}
		})
	}
}

func TestSnapshotItemPreservesTypedValuesAndDetachesNestedStorage(t *testing.T) {
	type record struct {
		Values []int
		Data   map[string][]byte
	}
	bytes := []byte{1, 2, 3, 4}
	value := &record{Values: []int{1, 2}, Data: map[string][]byte{"bytes": bytes[1:3]}}
	original := ItemSnapshot{"id": uint64(7), "value": value, "array": [1][]int{{1}}, "nil": []int(nil), "empty": []int{}}
	copy := SnapshotItem(original, true)
	value.Values[0] = 9
	bytes[1] = 9
	original["array"].([1][]int)[0][0] = 9
	got := copy["value"].(*record)
	if got.Values[0] != 1 || got.Data["bytes"][0] != 2 || copy["array"].([1][]int)[0][0] != 1 {
		t.Fatalf("nested storage was borrowed: %#v", copy)
	}
	if _, ok := copy["id"].(uint64); !ok {
		t.Fatal("numeric type changed")
	}
	if !reflect.ValueOf(copy["nil"]).IsNil() || reflect.ValueOf(copy["empty"]).IsNil() {
		t.Fatal("nil and empty slices were conflated")
	}
	borrowed := SnapshotItem(original, false)
	borrowed["probe"] = true
	if original["probe"] != true {
		t.Fatal("explicit no-copy override copied the outer map")
	}
}

func TestTrackersCanTakeOwnershipWithoutCopies(t *testing.T) {
	item := ItemSnapshot{"id": "a", "data": map[string]any{"count": 0}}
	tracker := NewNaiveItemDiffTracker("id")
	tracker.DeepCopy = false
	created, _, _ := tracker.Compute([]ItemSnapshot{item})
	created[0]["probe"] = true // Identity probe only; published values are otherwise read-only.
	if item["probe"] != true {
		t.Fatal("owned input was copied")
	}
	seeded := NewNaiveItemDiffTracker("id")
	seeded.SeedOwned([]ItemSnapshot{item})
	_, updates, _ := seeded.Compute([]ItemSnapshot{{"id": "a", "data": map[string]any{"count": 1}}})
	if len(updates) != 1 {
		t.Fatal("ownership-transfer seeding lost baseline")
	}
}

func TestBorrowedScanRetainsOwnedFieldsBeforeNextProjection(t *testing.T) {
	value := map[string]any{"values": []int{0}}
	tracker := NewNaiveItemDiffTracker("id")
	initial, _, _ := tracker.ComputeBorrowed(2, func(index int) ItemSnapshot { return ItemSnapshot{"id": index, "x": 0, "data": value} })
	previous := initial[0]["data"]
	_, updates, _ := tracker.ComputeBorrowed(2, func(index int) ItemSnapshot {
		if index == 1 {
			value["values"].([]int)[0] = 9
		}
		return ItemSnapshot{"id": index, "x": 1, "data": value}
	})
	if len(updates) != 2 || !reflect.DeepEqual(initial[0]["data"], map[string]any{"values": []int{0}}) {
		t.Fatal("borrowed data escaped the synchronous materialization")
	}
	if reflect.ValueOf(previous).Pointer() != reflect.ValueOf(tracker.prev[0]["data"]).Pointer() {
		t.Fatal("equal owned field was unnecessarily copied")
	}
	value["values"].([]int)[0] = 10
	if tracker.prev[1]["data"].(map[string]any)["values"].([]int)[0] != 9 {
		t.Fatal("changed value was not detached")
	}
}

func TestScalarSliceSnapshotsPreserveTypesAndDetach(t *testing.T) {
	for _, value := range []any{[]byte{1}, []string{"a"}, []int{1}, []float32{1}, []float64{1}, []bool{true}} {
		t.Run(reflect.TypeOf(value).String(), func(t *testing.T) {
			detached := SnapshotValue(value, true)
			if !reflect.DeepEqual(detached, value) {
				t.Fatal("snapshot changed value or type")
			}
			source := reflect.ValueOf(value)
			source.Index(0).Set(reflect.Zero(source.Type().Elem()))
			if reflect.DeepEqual(detached, value) {
				t.Fatal("snapshot retained model backing array")
			}
			for _, size := range []int{-1, 0} {
				var original reflect.Value
				if size < 0 {
					original = reflect.Zero(source.Type())
				} else {
					original = reflect.MakeSlice(source.Type(), 0, 0)
				}
				if !reflect.DeepEqual(original.Interface(), SnapshotValue(original.Interface(), true)) {
					t.Fatal("nil/empty distinction lost")
				}
			}
		})
	}
}

func TestBorrowedTrackersConsumeDiffBeforeReusingProjection(t *testing.T) {
	for _, precise := range []bool{false, true} {
		t.Run(map[bool]string{false: "naive", true: "precise"}[precise], func(t *testing.T) {
			naive := NewNaiveItemDiffTracker("id")
			tracker := NewItemDiffTracker[int]()
			naive.DeepCopy = false
			tracker.DeepCopy = false // Borrowed methods still establish ownership.
			data := []int{0}
			scratch := ItemSnapshot{}
			phase := 0
			project := func(id int) ItemSnapshot {
				clear(scratch)
				scratch["id"] = id
				scratch["data"] = data
				if phase == 0 {
					scratch["removed"] = true
				}
				if phase >= 2 {
					scratch["new"] = nil
				}
				return scratch
			}
			compute := func() ([]ItemSnapshot, []ItemSnapshot, []any) {
				if precise {
					return tracker.ComputeBorrowed([]int{0, 1}, func(id int) any { return id }, func(int) bool { return true }, project)
				}
				return naive.ComputeBorrowed(2, project)
			}
			initial, _, _ := compute()
			phase = 1
			data[0] = 1
			_, updates, _ := compute()
			if len(updates) != 2 || !reflect.DeepEqual(updates[0], ItemSnapshot{"id": 0, "data": []int{1}, "removed": nil}) {
				t.Fatalf("unexpected updates: %v", updates)
			}
			saved := updates[0]
			phase = 2
			data[0] = 2
			_, next, _ := compute()
			if len(next) != 2 || !reflect.DeepEqual(initial[0]["data"], []int{0}) || !reflect.DeepEqual(saved["data"], []int{1}) {
				t.Fatal("reusing raw/diff storage rewrote retained payloads")
			}
			if value, present := next[0]["new"]; !present || value != nil {
				t.Fatal("new explicit nil field was lost")
			}
			if _, present := next[0]["removed"]; present {
				t.Fatal("omitted field persisted in baseline")
			}
			if _, unchanged, _ := compute(); len(unchanged) != 0 {
				t.Fatal("unchanged borrowed projection emitted updates")
			}
		})
	}
}

func TestSnapshotStructPlansDoNotRetainValues(t *testing.T) {
	type record struct {
		ID      int
		Values  []int
		Other   map[string]any
		private []int
	}
	type reversed struct {
		Other []int
		ID    int
	}
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			value := record{ID: i, Values: []int{i}, Other: map[string]any{"value": i}, private: []int{i}}
			got := SnapshotValue(value, true).(record)
			value.Values[0] = -1
			value.Other["value"] = -1
			if got.ID != i || got.Values[0] != i || got.Other["value"] != i || got.private[0] != i {
				t.Errorf("type plan cached values or lost fields for %d", i)
			}
			other := reversed{Other: []int{i}, ID: i}
			copy := SnapshotValue(other, true).(reversed)
			other.Other[0] = -1
			if copy.ID != i || copy.Other[0] != i {
				t.Error("type plans were shared across different types")
			}
		}(i)
	}
	wg.Wait()
}

func TestSnapshotRecursiveTypesRespectDepthLimit(t *testing.T) {
	type node struct{ Next *node }
	value := &node{}
	value.Next = value
	defer func() {
		if recovered := recover(); recovered != "abm: projected snapshot is cyclic or exceeds maximum nesting depth" {
			t.Fatalf("unexpected recursion result: %v", recovered)
		}
	}()
	SnapshotValue(value, true)
}

func TestDiffTrackersPopulationChurn(t *testing.T) {
	for _, precise := range []bool{false, true} {
		t.Run(map[bool]string{false: "naive", true: "precise"}[precise], func(t *testing.T) {
			naive := NewNaiveItemDiffTracker("id")
			tracker := NewItemDiffTracker[ItemSnapshot]()
			naive.DeepCopy = false
			tracker.DeepCopy = false
			previous := map[int]bool{}
			for phase, count := range []int{100, 100, 10, 0, 1000, 2000, 1900, 2, 0, 3} {
				items := make([]ItemSnapshot, count)
				current := map[int]bool{}
				for i := range items {
					id := i + phase%2
					items[i] = ItemSnapshot{"id": id, "x": phase}
					current[id] = true
				}
				compute := func() ([]ItemSnapshot, []ItemSnapshot, []any) {
					if precise {
						return tracker.Compute(items, func(item ItemSnapshot) any { return item["id"] }, func(ItemSnapshot) bool { return true }, func(item ItemSnapshot) ItemSnapshot { return item })
					}
					return naive.Compute(items)
				}
				created, updated, deleted := compute()
				newCount, oldCount, removedCount := 0, 0, 0
				for id := range current {
					if previous[id] {
						oldCount++
					} else {
						newCount++
					}
				}
				for id := range previous {
					if !current[id] {
						removedCount++
					}
				}
				if len(created) != newCount || len(updated) != oldCount || len(deleted) != removedCount {
					t.Fatalf("phase %d: created/updated/deleted=%d/%d/%d, want %d/%d/%d", phase, len(created), len(updated), len(deleted), newCount, oldCount, removedCount)
				}
				for _, id := range deleted {
					if !previous[id.(int)] || current[id.(int)] {
						t.Fatalf("incorrect deletion: %v", id)
					}
				}
				if c, u, d := compute(); len(c)+len(u)+len(d) != 0 {
					t.Fatalf("phase %d: unchanged population emitted changes", phase)
				}
				previous = current
			}
			naive.Reset()
			tracker.Reset()
			if naive.DeepCopy || tracker.DeepCopy {
				t.Fatal("Reset changed configured copying policy")
			}
			if precise {
				created, _, _ := tracker.Compute([]ItemSnapshot{{"id": 1}}, func(item ItemSnapshot) any { return item["id"] }, func(ItemSnapshot) bool { return true }, func(item ItemSnapshot) ItemSnapshot { return item })
				if len(created) != 1 {
					t.Fatal("Reset retained old membership")
				}
			} else {
				created, _, _ := naive.Compute([]ItemSnapshot{{"id": 1}})
				if len(created) != 1 {
					t.Fatal("Reset retained old membership")
				}
			}
		})
	}
}
