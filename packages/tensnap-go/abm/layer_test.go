package abm

import (
	"reflect"
	"testing"
)

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
