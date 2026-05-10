package abm

// ClampInt clamps v to [lo, hi].
func ClampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// ClampFloat clamps v to [lo, hi].
func ClampFloat(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// AsFloat64 converts common numeric types to float64.
// Returns (0, false) for unrecognized types.
func AsFloat64(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int32:
		return float64(n), true
	case int64:
		return float64(n), true
	case uint:
		return float64(n), true
	case uint32:
		return float64(n), true
	case uint64:
		return float64(n), true
	}
	return 0, false
}

// DefaultedInt returns value if > 0, otherwise fallback.
func DefaultedInt(value, fallback int) int {
	if value <= 0 {
		return fallback
	}
	return value
}

// DefaultedFloat returns value if > 0, otherwise fallback.
func DefaultedFloat(value, fallback float64) float64 {
	if value <= 0 {
		return fallback
	}
	return value
}
