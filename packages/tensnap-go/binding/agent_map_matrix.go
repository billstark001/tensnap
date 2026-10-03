package binding

import (
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
)

// MapEntry is a view of a model-owned map entry, not an object stored by the model.
type MapEntry[K comparable, V any] struct {
	Key   K
	Value V
}

// MapAgentLayer projects map entries through the existing agent diff machinery.
// Entries are ordered by their encoded protocol ID for reproducible snapshots.
type MapAgentLayer[M any, K comparable, V any] struct {
	*AgentLayer[M, MapEntry[K, V]]
	encode func(K) any
	source func(M) map[K]V
}

func NewMapAgentLayer[M any, K comparable, V any](id string) *MapAgentLayer[M, K, V] {
	l := &MapAgentLayer[M, K, V]{AgentLayer: NewAgentLayer[M, MapEntry[K, V]](id)}
	l.encode = func(key K) any { return key }
	l.AgentLayer.ItemID(func(_ M, entry MapEntry[K, V]) any { return l.encode(entry.Key) })
	l.AgentLayer.Project(func(_ M, entry MapEntry[K, V]) map[string]any {
		return map[string]any{"id": l.encode(entry.Key), "data": map[string]any{"value": entry.Value}}
	})
	return l
}

func sourceID(value any) string {
	id, err := checkedSourceID(value)
	if err != nil {
		panic(err)
	}
	return id
}

func checkedSourceID(value any) (string, error) {
	const maxSafeID = 9007199254740991
	switch value.(type) {
	case string, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
	case float64:
		if value.(float64) != float64(int64(value.(float64))) || value.(float64) > maxSafeID || value.(float64) < -maxSafeID {
			return "", fmt.Errorf("map agent ID must be a safe integer")
		}
	default:
		return "", fmt.Errorf("map agent ID must be a string or integer, got %T", value)
	}
	rv := reflect.ValueOf(value)
	switch rv.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		if rv.Int() > maxSafeID || rv.Int() < -maxSafeID {
			return "", fmt.Errorf("map agent ID exceeds JSON safe range")
		}
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		if rv.Uint() > maxSafeID {
			return "", fmt.Errorf("map agent ID exceeds JSON safe range")
		}
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func (l *MapAgentLayer[M, K, V]) Source(fn func(M) map[K]V) *MapAgentLayer[M, K, V] {
	l.source = fn
	l.AgentLayer.Items(func(model M) []MapEntry[K, V] {
		entries := make([]MapEntry[K, V], 0, len(fn(model)))
		for key, value := range fn(model) {
			entries = append(entries, MapEntry[K, V]{key, value})
		}
		sort.Slice(entries, func(i, j int) bool {
			return sourceID(l.encode(entries[i].Key)) < sourceID(l.encode(entries[j].Key))
		})
		for i := 1; i < len(entries); i++ {
			if sourceID(l.encode(entries[i-1].Key)) == sourceID(l.encode(entries[i].Key)) {
				panic("map source has duplicate encoded IDs")
			}
		}
		return entries
	})
	return l
}

func decodeSourceValue[V any](value any) (V, error) {
	var decoded V
	raw, err := json.Marshal(value)
	if err != nil {
		return decoded, err
	}
	err = json.Unmarshal(raw, &decoded)
	return decoded, err
}

// RestoreSource installs a complete map inverse. It validates every item before
// clearing the model-owned map. Nil decoders use JSON conversion to K and V.
func (l *MapAgentLayer[M, K, V]) RestoreSource(
	decodeKey func(any) (K, error), decodeValue func(any) (V, error),
) *MapAgentLayer[M, K, V] {
	if decodeKey == nil {
		decodeKey = decodeSourceValue[K]
	}
	if decodeValue == nil {
		decodeValue = decodeSourceValue[V]
	}
	parse := func(items []map[string]any) (map[K]V, error) {
		result := make(map[K]V, len(items))
		ids := make(map[string]bool, len(items))
		for _, item := range items {
			id, ok := item["id"]
			if !ok {
				return nil, fmt.Errorf("map item is missing id")
			}
			marker, err := checkedSourceID(id)
			if err != nil {
				return nil, err
			}
			if ids[marker] {
				return nil, fmt.Errorf("duplicate map ID %s", marker)
			}
			ids[marker] = true
			key, err := decodeKey(id)
			if err != nil {
				return nil, err
			}
			encoded, err := checkedSourceID(l.encode(key))
			if err != nil {
				return nil, err
			}
			if encoded != marker {
				return nil, fmt.Errorf("noncanonical map ID %s", marker)
			}
			if _, exists := result[key]; exists {
				return nil, fmt.Errorf("duplicate decoded map key %s", marker)
			}
			data, err := restoreRecord(item["data"])
			if err != nil {
				return nil, err
			}
			raw, ok := data["value"]
			if !ok {
				return nil, fmt.Errorf("map item %s is missing data.value", marker)
			}
			value, err := decodeValue(raw)
			if err != nil {
				return nil, err
			}
			result[key] = value
		}
		return result, nil
	}
	l.AgentLayer.Restore(RestoreLayer[M]{
		Metadata: func(_ M, _ map[string]any) error { return nil },
		Validate: func(_ M, layer map[string]any) error {
			items, err := restoreRecords(layer["items"])
			if err != nil {
				return err
			}
			_, err = parse(items)
			return err
		},
		Replace: func(model M, items []map[string]any) error {
			values, err := parse(items)
			if err != nil {
				return err
			}
			if l.source == nil {
				return fmt.Errorf("map source is not configured")
			}
			target := l.source(model)
			if target == nil {
				return fmt.Errorf("map source is nil")
			}
			for key := range target {
				delete(target, key)
			}
			for key, value := range values {
				target[key] = value
			}
			return nil
		},
	})
	return l
}

func (l *MapAgentLayer[M, K, V]) EncodeKey(fn func(K) any) *MapAgentLayer[M, K, V] {
	l.encode = fn
	return l
}

func (l *MapAgentLayer[M, K, V]) Project(fn func(M, K, V) map[string]any) *MapAgentLayer[M, K, V] {
	l.AgentLayer.Project(func(model M, entry MapEntry[K, V]) map[string]any {
		record := fn(model, entry.Key, entry.Value)
		if record == nil {
			record = map[string]any{}
		}
		data := map[string]any{}
		if original, ok := record["data"]; ok {
			values, valid := original.(map[string]any)
			if !valid {
				panic("map agent data must be a map[string]any")
			}
			for name, value := range values {
				data[name] = value
			}
		}
		data["value"] = entry.Value
		record["data"] = data
		record["id"] = l.encode(entry.Key)
		return record
	})
	return l
}

func (l *MapAgentLayer[M, K, V]) Field(name string, fn func(M, K, V) any) *MapAgentLayer[M, K, V] {
	if name == "id" || name == "data" {
		panic("map agent id and data are derived from the source")
	}
	l.AgentLayer.Field(name, func(model M, entry MapEntry[K, V]) any {
		return fn(model, entry.Key, entry.Value)
	})
	return l
}

func (l *MapAgentLayer[M, K, V]) Const(name string, value any) *MapAgentLayer[M, K, V] {
	return l.Field(name, func(M, K, V) any { return value })
}

func (l *MapAgentLayer[M, K, V]) Select(name, path string) *MapAgentLayer[M, K, V] {
	root, parts := compileSourcePath(path, "value", "model", "key", "value")
	return l.Field(name, func(model M, key K, value V) any {
		switch root {
		case "model":
			return readSourcePath(model, parts)
		case "key":
			return readSourcePath(key, parts)
		default:
			return readSourcePath(value, parts)
		}
	})
}

func (l *MapAgentLayer[M, K, V]) Changed(fn func(M, K, V) bool) *MapAgentLayer[M, K, V] {
	l.AgentLayer.Changed(func(model M, entry MapEntry[K, V]) bool {
		return fn(model, entry.Key, entry.Value)
	})
	return l
}

func (l *MapAgentLayer[M, K, V]) Restore(spec RestoreLayer[M]) *MapAgentLayer[M, K, V] {
	l.AgentLayer.Restore(spec)
	return l
}

// MatrixCell uses row-major, zero-based coordinates. Renderer x is col and y
// is height-1-row, matching the Python matrix agent convention.
type MatrixCell[V any] struct {
	Row, Col int
	Value    V
	Height   int
}

type MatrixAgentLayer[M any, V any] struct {
	*AgentLayer[M, MatrixCell[V]]
	source                      func(M) [][]V
	restoreHeight, restoreWidth int
}

func NewMatrixAgentLayer[M any, V any](id string) *MatrixAgentLayer[M, V] {
	l := &MatrixAgentLayer[M, V]{AgentLayer: NewAgentLayer[M, MatrixCell[V]](id)}
	l.AgentLayer.ItemID(func(_ M, cell MatrixCell[V]) any {
		return fmt.Sprintf("cell:%d:%d", cell.Row, cell.Col)
	})
	l.AgentLayer.Project(func(_ M, cell MatrixCell[V]) map[string]any {
		return map[string]any{
			"id": fmt.Sprintf("cell:%d:%d", cell.Row, cell.Col),
			"x":  cell.Col, "y": cell.Height - 1 - cell.Row,
			"icon": "square", "size": 1,
			"data": map[string]any{"value": cell.Value},
		}
	})
	return l
}

func (l *MatrixAgentLayer[M, V]) Source(fn func(M) [][]V) *MatrixAgentLayer[M, V] {
	l.source = fn
	l.AgentLayer.Items(func(model M) []MatrixCell[V] {
		matrix := fn(model)
		height := len(matrix)
		width := 0
		if height > 0 {
			width = len(matrix[0])
		}
		cells := make([]MatrixCell[V], 0, height*width)
		for row, values := range matrix {
			if len(values) != width {
				panic("matrix agent source must be rectangular")
			}
			for col, value := range values {
				cells = append(cells, MatrixCell[V]{row, col, value, height})
			}
		}
		return cells
	})
	l.AgentLayer.Data(func(model M) map[string]any {
		matrix := fn(model)
		width := 0
		if len(matrix) > 0 {
			width = len(matrix[0])
		}
		return map[string]any{"width": width, "height": len(matrix), "coord_offset": "int"}
	})
	return l
}

// RestoreSource validates a complete dense matrix before mutation. A custom
// replace callback can rebuild storage when dimensions change or Flat is used.
func (l *MatrixAgentLayer[M, V]) RestoreSource(
	decodeValue func(any) (V, error), replace func(M, [][]V) error,
) *MatrixAgentLayer[M, V] {
	if decodeValue == nil {
		decodeValue = decodeSourceValue[V]
	}
	parse := func(items []map[string]any, height, width int) ([][]V, error) {
		values := make([][]V, height)
		for row := range values {
			values[row] = make([]V, width)
		}
		seen := make(map[string]bool, height*width)
		for _, item := range items {
			id, ok := item["id"].(string)
			var row, col int
			count, scanErr := fmt.Sscanf(id, "cell:%d:%d", &row, &col)
			if !ok || scanErr != nil || count != 2 || id != fmt.Sprintf("cell:%d:%d", row, col) {
				return nil, fmt.Errorf("invalid matrix ID %v", item["id"])
			}
			if row < 0 || col < 0 || row >= height || col >= width || seen[id] {
				return nil, fmt.Errorf("duplicate or out-of-bounds matrix cell")
			}
			if !reflect.DeepEqual(item["x"], col) && !reflect.DeepEqual(item["x"], float64(col)) {
				return nil, fmt.Errorf("matrix x does not match ID")
			}
			y := height - 1 - row
			if !reflect.DeepEqual(item["y"], y) && !reflect.DeepEqual(item["y"], float64(y)) {
				return nil, fmt.Errorf("matrix y does not match ID")
			}
			data, err := restoreRecord(item["data"])
			if err != nil {
				return nil, err
			}
			raw, ok := data["value"]
			if !ok {
				return nil, fmt.Errorf("matrix cell is missing data.value")
			}
			value, err := decodeValue(raw)
			if err != nil {
				return nil, err
			}
			values[row][col] = value
			seen[id] = true
		}
		if len(seen) != height*width {
			return nil, fmt.Errorf("dense matrix is missing cells")
		}
		return values, nil
	}
	l.AgentLayer.Restore(RestoreLayer[M]{
		Validate: func(_ M, layer map[string]any) error {
			metadata, err := restoreRecord(layer["metadata"])
			if err != nil {
				return err
			}
			var height, width int
			if err = decodeInt(metadata["height"], &height); err != nil {
				return err
			}
			if err = decodeInt(metadata["width"], &width); err != nil {
				return err
			}
			if height < 0 || width < 0 || metadata["coord_offset"] != "int" {
				return fmt.Errorf("invalid matrix metadata")
			}
			items, err := restoreRecords(layer["items"])
			if err != nil {
				return err
			}
			if _, err = parse(items, height, width); err != nil {
				return err
			}
			l.restoreHeight, l.restoreWidth = height, width
			return nil
		},
		Metadata: func(_ M, _ map[string]any) error { return nil },
		Replace: func(model M, items []map[string]any) error {
			values, err := parse(items, l.restoreHeight, l.restoreWidth)
			if err != nil {
				return err
			}
			if replace != nil {
				return replace(model, values)
			}
			if l.source == nil {
				return fmt.Errorf("matrix source is not configured")
			}
			target := l.source(model)
			if len(target) != l.restoreHeight {
				return fmt.Errorf("matrix shape changed; supply replace")
			}
			for row := range target {
				if len(target[row]) != l.restoreWidth {
					return fmt.Errorf("matrix shape changed; supply replace")
				}
			}
			for row := range target {
				copy(target[row], values[row])
			}
			return nil
		},
	})
	return l
}

func decodeInt(value any, target *int) error {
	decoded, err := decodeSourceValue[int](value)
	if err != nil {
		return err
	}
	*target = decoded
	return nil
}

// Flat supports arrays, slices, and other storage without allocating [][]V.
func (l *MatrixAgentLayer[M, V]) Flat(shape func(M) (int, int), at func(M, int, int) V) *MatrixAgentLayer[M, V] {
	l.AgentLayer.Items(func(model M) []MatrixCell[V] {
		height, width := shape(model)
		if height < 0 || width < 0 {
			panic("matrix shape must be nonnegative")
		}
		cells := make([]MatrixCell[V], 0, height*width)
		for row := 0; row < height; row++ {
			for col := 0; col < width; col++ {
				cells = append(cells, MatrixCell[V]{row, col, at(model, row, col), height})
			}
		}
		return cells
	})
	l.AgentLayer.Data(func(model M) map[string]any {
		height, width := shape(model)
		return map[string]any{"width": width, "height": height, "coord_offset": "int"}
	})
	return l
}

func (l *MatrixAgentLayer[M, V]) Project(fn func(M, int, int, V) map[string]any) *MatrixAgentLayer[M, V] {
	l.AgentLayer.Project(func(model M, cell MatrixCell[V]) map[string]any {
		record := fn(model, cell.Row, cell.Col, cell.Value)
		if record == nil {
			record = map[string]any{}
		}
		data := map[string]any{}
		if original, ok := record["data"]; ok {
			values, valid := original.(map[string]any)
			if !valid {
				panic("matrix agent data must be a map[string]any")
			}
			for name, value := range values {
				data[name] = value
			}
		}
		data["value"] = cell.Value
		record["data"] = data
		record["id"] = fmt.Sprintf("cell:%d:%d", cell.Row, cell.Col)
		record["x"], record["y"] = cell.Col, cell.Height-1-cell.Row
		return record
	})
	return l
}

func (l *MatrixAgentLayer[M, V]) Field(name string, fn func(M, int, int, V) any) *MatrixAgentLayer[M, V] {
	if name == "id" || name == "x" || name == "y" || name == "data" {
		panic("matrix agent id, coordinates, and data are derived from the source")
	}
	l.AgentLayer.Field(name, func(model M, cell MatrixCell[V]) any {
		return fn(model, cell.Row, cell.Col, cell.Value)
	})
	return l
}

func (l *MatrixAgentLayer[M, V]) Const(name string, value any) *MatrixAgentLayer[M, V] {
	return l.Field(name, func(M, int, int, V) any { return value })
}

func (l *MatrixAgentLayer[M, V]) Select(name, path string) *MatrixAgentLayer[M, V] {
	root, parts := compileSourcePath(path, "value", "model", "row", "col", "value", "key")
	return l.Field(name, func(model M, row, col int, value V) any {
		switch root {
		case "model":
			return readSourcePath(model, parts)
		case "row":
			return readSourcePath(row, parts)
		case "col":
			return readSourcePath(col, parts)
		case "key":
			return readSourcePath([2]int{row, col}, parts)
		default:
			return readSourcePath(value, parts)
		}
	})
}

func (l *MatrixAgentLayer[M, V]) Changed(fn func(M, int, int, V) bool) *MatrixAgentLayer[M, V] {
	l.AgentLayer.Changed(func(model M, cell MatrixCell[V]) bool {
		return fn(model, cell.Row, cell.Col, cell.Value)
	})
	return l
}

func (l *MatrixAgentLayer[M, V]) Restore(spec RestoreLayer[M]) *MatrixAgentLayer[M, V] {
	l.AgentLayer.Restore(spec)
	return l
}
