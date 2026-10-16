package abm

import (
	"reflect"
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
