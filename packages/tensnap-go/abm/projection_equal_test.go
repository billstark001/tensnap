package abm

import (
	"encoding/json"
	"math"
	"reflect"
	"testing"
)

func TestProjectionEqualMatchesDeepEqual(t *testing.T) {
	type namedMap map[string]any
	type namedSlice []int
	type namedInt int
	type record struct {
		Values  []int
		private map[string]int
	}
	nan := math.NaN()
	sharedMap := map[string]any{"nan": nan, "function": func() {}}
	sharedSlice := []any{nan, func() {}}
	floatSlice := []float64{nan}
	cycleA, cycleB := map[string]any{}, map[string]any{}
	cycleA["self"], cycleB["self"] = cycleA, cycleB
	cycleDifferent := map[string]any{"extra": true}
	cycleDifferent["self"] = cycleDifferent
	sliceCycleA, sliceCycleB := make([]any, 1), make([]any, 1)
	sliceCycleA[0], sliceCycleB[0] = sliceCycleA, sliceCycleB
	var deepA, deepB any = 1, 1
	for i := 0; i < maxProjectionEqualDepth+5; i++ {
		deepA = []any{deepA}
		deepB = []any{deepB}
	}
	values := []any{nil, true, false, "", "x", 1, int8(1), int16(1), int32(1), int64(1), uint(1), uint8(1), uint16(1), uint32(1), uint64(1), uintptr(1), float32(1), float64(1), complex64(1), complex128(1), nan, math.Inf(1), namedInt(1),
		map[string]any(nil), map[string]any{}, map[string]any{"x": nil}, map[string]any{"x": 1}, map[string]any{"x": []any{map[string]any{"x": 1}}}, map[string]any{"x": []any{map[string]any{"x": 1}}},
		[]any(nil), []any{}, []any{nil}, []any{1}, []any{1}, []any{nan}, []any{nan},
		[]byte(nil), []byte{}, []byte{1}, []byte{1}, []string(nil), []string{}, []string{"a"}, []string{"a"},
		[]int(nil), []int{}, []int{1}, []int{1}, []float64(nil), []float64{}, floatSlice, append([]float64{}, floatSlice...), []float32{float32(nan)}, []bool{true}, []bool{true},
		namedMap{"x": []int{1}}, namedMap{"x": []int{1}}, namedSlice{1}, namedSlice{1}, &record{Values: []int{1}, private: map[string]int{"x": 1}}, &record{Values: []int{1}, private: map[string]int{"x": 1}},
		sharedMap, sharedMap, sharedSlice, sharedSlice, cycleA, cycleB, cycleDifferent, sliceCycleA, sliceCycleB, deepA, deepB,
	}
	for i, a := range values {
		for j, b := range values {
			if got, want := projectionEqual(a, b), reflect.DeepEqual(a, b); got != want {
				t.Fatalf("pair %d/%d (%T/%T): equal=%v, want %v", i, j, a, b, got, want)
			}
		}
	}
}

func FuzzProjectionEqual(f *testing.F) {
	for _, seed := range [][2]string{{`null`, `[]`}, {`{}`, `{"x":null}`}, {`{"x":[1,"a",null]}`, `{"x":[1,"a",null]}`}, {`{"x":[1]}`, `{"x":[2]}`}} {
		f.Add(seed[0], seed[1])
	}
	f.Fuzz(func(t *testing.T, left, right string) {
		if len(left) > 4096 || len(right) > 4096 {
			t.Skip()
		}
		var a, b any
		if json.Unmarshal([]byte(left), &a) != nil || json.Unmarshal([]byte(right), &b) != nil {
			return
		}
		if got, want := projectionEqual(a, b), reflect.DeepEqual(a, b); got != want {
			t.Fatalf("comparison differs for %q and %q", left, right)
		}
	})
}

func BenchmarkProjectionEqual(b *testing.B) {
	for _, shape := range []string{"scalar", "nested", "typed"} {
		var left, right any = 42, 42
		switch shape {
		case "nested":
			left = map[string]any{"count": 42, "tags": []any{"ready"}}
			right = SnapshotValue(left, true)
		case "typed":
			left = []string{"ready", "active"}
			right = SnapshotValue(left, true)
		}
		for _, method := range []string{"protocol", "reflect"} {
			b.Run(shape+"/"+method, func(b *testing.B) {
				equal := projectionEqual
				if method == "reflect" {
					equal = reflect.DeepEqual
				}
				b.ReportAllocs()
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					if !equal(left, right) {
						b.Fatal("unequal fixture")
					}
				}
			})
		}
	}
}

func BenchmarkSnapshotStruct(b *testing.B) {
	type record struct {
		ID      int
		X, Y    float64
		Label   string
		Visible bool
		Data    map[string]any
		Tags    []string
	}
	value := &record{ID: 1, X: 2, Y: 3, Label: "agent", Visible: true, Data: map[string]any{"count": 1}, Tags: []string{"ready"}}
	// Warm any process-local type plans outside the timed allocation interval.
	SnapshotValue(value, true)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		copy := SnapshotValue(value, true).(*record)
		if copy.Data["count"] != 1 {
			b.Fatal("invalid snapshot")
		}
	}
}
