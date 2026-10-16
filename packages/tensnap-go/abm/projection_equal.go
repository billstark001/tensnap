package abm

import (
	"maps"
	"reflect"
	"slices"
)

// Bound the allocation-free protocol-container walk. DeepEqual remains the
// fallback for other Go types and cyclic/deep graphs, including DictDiff inputs
// that do not pass through the acyclic snapshot boundary.
const maxProjectionEqualDepth = 64

func projectionEqual(a, b any) bool {
	return projectionEqualDepth(a, b, 0)
}

func projectionEqualDepth(a, b any, depth int) bool {
	if depth >= maxProjectionEqualDepth {
		return reflect.DeepEqual(a, b)
	}
	switch a := a.(type) {
	case nil:
		return b == nil
	case bool, string, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, uintptr, float32, float64, complex64, complex128:
		return a == b
	case map[string]any:
		other, ok := b.(map[string]any)
		if !ok || (a == nil) != (other == nil) || len(a) != len(other) {
			return false
		}
		// DeepEqual considers a map equal to itself even with NaNs/functions.
		// Pointer identity needs no reflected iteration or temporary key values.
		if reflect.ValueOf(a).UnsafePointer() == reflect.ValueOf(other).UnsafePointer() {
			return true
		}
		return maps.EqualFunc(a, other, func(x, y any) bool { return projectionEqualDepth(x, y, depth+1) })
	case []any:
		other, ok := b.([]any)
		if !ok || (a == nil) != (other == nil) || len(a) != len(other) {
			return false
		}
		if len(a) > 0 && &a[0] == &other[0] {
			return true
		}
		return slices.EqualFunc(a, other, func(x, y any) bool { return projectionEqualDepth(x, y, depth+1) })
	case []byte:
		other, ok := b.([]byte)
		return ok && equalScalarSlice(a, other)
	case []string:
		other, ok := b.([]string)
		return ok && equalScalarSlice(a, other)
	case []int:
		other, ok := b.([]int)
		return ok && equalScalarSlice(a, other)
	case []int8:
		other, ok := b.([]int8)
		return ok && equalScalarSlice(a, other)
	case []int16:
		other, ok := b.([]int16)
		return ok && equalScalarSlice(a, other)
	case []int32:
		other, ok := b.([]int32)
		return ok && equalScalarSlice(a, other)
	case []int64:
		other, ok := b.([]int64)
		return ok && equalScalarSlice(a, other)
	case []uint:
		other, ok := b.([]uint)
		return ok && equalScalarSlice(a, other)
	case []uint16:
		other, ok := b.([]uint16)
		return ok && equalScalarSlice(a, other)
	case []uint32:
		other, ok := b.([]uint32)
		return ok && equalScalarSlice(a, other)
	case []uint64:
		other, ok := b.([]uint64)
		return ok && equalScalarSlice(a, other)
	case []float64:
		other, ok := b.([]float64)
		return ok && equalScalarSlice(a, other)
	case []float32:
		other, ok := b.([]float32)
		return ok && equalScalarSlice(a, other)
	case []bool:
		other, ok := b.([]bool)
		return ok && equalScalarSlice(a, other)
	default:
		return reflect.DeepEqual(a, b)
	}
}

func equalScalarSlice[T comparable](a, b []T) bool {
	if (a == nil) != (b == nil) || len(a) != len(b) {
		return false
	}
	// Preserve DeepEqual's backing-array identity rule, including NaN elements.
	return len(a) > 0 && &a[0] == &b[0] || slices.Equal(a, b)
}
