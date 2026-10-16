package abm

import (
	"bytes"
	"reflect"
)

const maxSnapshotDepth = 1024

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
			for i := 0; i < value.NumField(); i++ {
				if value.Type().Field(i).PkgPath == "" {
					out.Field(i).Set(snapshotReflect(value.Field(i), depth+1))
				}
			}
		}
		return out
	default:
		return value
	}
}

// snapshotItemReusing detaches borrowed fields after comparison. Equal values
// may share the immutable previous snapshot, never the mutable model graph.
func snapshotItemReusing(item, previous ItemSnapshot) ItemSnapshot {
	if item == nil {
		return nil
	}
	out := make(ItemSnapshot, len(item))
	for key, value := range item {
		if old, present := previous[key]; present && reflect.DeepEqual(old, value) {
			out[key] = old
		} else {
			out[key] = snapshotValue(value, 0)
		}
	}
	return out
}
