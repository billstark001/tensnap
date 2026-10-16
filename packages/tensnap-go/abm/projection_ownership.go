package abm

import (
	"bytes"
	"reflect"
	"slices"
	"sync"
)

const maxSnapshotDepth = 1024

// Cache only immutable type metadata, never model values or traversal state.
// Plans do not recursively compile child types, so recursive Go types are safe.
var snapshotStructPlans sync.Map // map[reflect.Type][]int

func snapshotStructFields(typ reflect.Type) []int {
	if plan, ok := snapshotStructPlans.Load(typ); ok {
		return plan.([]int)
	}
	var fields []int
	for i := 0; i < typ.NumField(); i++ {
		field := typ.Field(i)
		if field.PkgPath != "" {
			continue
		}
		switch field.Type.Kind() {
		case reflect.Interface, reflect.Pointer, reflect.Map, reflect.Slice, reflect.Array, reflect.Struct:
			fields = append(fields, i)
		}
	}
	plan, _ := snapshotStructPlans.LoadOrStore(typ, fields)
	return plan.([]int)
}

// SnapshotItem detaches a projection before retaining or publishing it. With
// deepCopy=false, the caller transfers a stable snapshot and must never mutate
// it or its nested values again. Models may continue mutating their own state.
// Projected values must be acyclic, portable protocol data.
func SnapshotItem(item ItemSnapshot, deepCopy bool) ItemSnapshot {
	if !deepCopy || item == nil {
		return item
	}
	return snapshotValue(item, 0).(map[string]any)
}

// SnapshotValue detaches one projected field, including typed nested containers.
// With deepCopy=false, the field's producer remains responsible for stability.
func SnapshotValue(value any, deepCopy bool) any {
	if !deepCopy {
		return value
	}
	return snapshotValue(value, 0)
}

func snapshotValue(value any, depth int) any {
	if depth > maxSnapshotDepth {
		panic("abm: projected snapshot is cyclic or exceeds maximum nesting depth")
	}
	switch value := value.(type) {
	case nil, bool, string, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64:
		return value
	case map[string]any:
		if value == nil {
			return value
		}
		out := make(map[string]any, len(value))
		for key, entry := range value {
			out[key] = snapshotValue(entry, depth+1)
		}
		return out
	case []any:
		if value == nil {
			return value
		}
		out := make([]any, len(value))
		for i, entry := range value {
			out[i] = snapshotValue(entry, depth+1)
		}
		return out
	case []byte:
		return bytes.Clone(value)
	case []string:
		return slices.Clone(value)
	case []int:
		return slices.Clone(value)
	case []int8:
		return slices.Clone(value)
	case []int16:
		return slices.Clone(value)
	case []int32:
		return slices.Clone(value)
	case []int64:
		return slices.Clone(value)
	case []uint:
		return slices.Clone(value)
	case []uint16:
		return slices.Clone(value)
	case []uint32:
		return slices.Clone(value)
	case []uint64:
		return slices.Clone(value)
	case []float64:
		return slices.Clone(value)
	case []float32:
		return slices.Clone(value)
	case []bool:
		return slices.Clone(value)
	default:
		return snapshotReflect(reflect.ValueOf(value), depth).Interface()
	}
}

// Preserve named/typed containers and scalar types without a JSON round trip.
func snapshotReflect(value reflect.Value, depth int) reflect.Value {
	if depth > maxSnapshotDepth {
		panic("abm: projected snapshot is cyclic or exceeds maximum nesting depth")
	}
	switch value.Kind() {
	case reflect.Interface, reflect.Pointer:
		if value.IsNil() {
			return value
		}
		out := reflect.New(value.Type()).Elem()
		if value.Kind() == reflect.Pointer {
			out.Set(reflect.New(value.Type().Elem()))
			out.Elem().Set(snapshotReflect(value.Elem(), depth+1))
		} else {
			out.Set(snapshotReflect(value.Elem(), depth+1))
		}
		return out
	case reflect.Map:
		if value.IsNil() {
			return value
		}
		out := reflect.MakeMapWithSize(value.Type(), value.Len())
		iter := value.MapRange()
		for iter.Next() {
			out.SetMapIndex(iter.Key(), snapshotReflect(iter.Value(), depth+1))
		}
		return out
	case reflect.Slice:
		if value.IsNil() {
			return value
		}
		out := reflect.MakeSlice(value.Type(), value.Len(), value.Len())
		for i := 0; i < value.Len(); i++ {
			out.Index(i).Set(snapshotReflect(value.Index(i), depth+1))
		}
		return out
	case reflect.Array, reflect.Struct:
		out := reflect.New(value.Type()).Elem()
		out.Set(value)
		if value.Kind() == reflect.Array {
			for i := 0; i < value.Len(); i++ {
				out.Index(i).Set(snapshotReflect(value.Index(i), depth+1))
			}
		} else {
			for _, i := range snapshotStructFields(value.Type()) {
				out.Field(i).Set(snapshotReflect(value.Field(i), depth+1))
			}
		}
		return out
	default:
		return value
	}
}

// snapshotItemWithDiff consumes an already computed complete-record diff. Only
// changed fields need detachment; equal fields retain their previous owned
// values. Replace borrowed diff values before the payload can escape.
func snapshotItemWithDiff(item, previous, diff ItemSnapshot) ItemSnapshot {
	if item == nil {
		return nil
	}
	out := make(ItemSnapshot, len(item))
	for key, value := range item {
		if _, changed := diff[key]; changed {
			out[key] = snapshotValue(value, 0)
			diff[key] = out[key]
		} else {
			out[key] = previous[key]
		}
	}
	return out
}
