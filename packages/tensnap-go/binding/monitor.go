package binding

import "github.com/billstark001/tensnap/packages/tensnap-go/protocol"

// Monitor is a declarative current-value binding. It owns its metadata and
// accepts ordinary Go values; the protocol codec handles JSON/MessagePack.
type Monitor[T any] struct {
	ID         string
	Label      string
	RenderHint string
	getter     func(T) (any, error)
}

func NewMonitor[T any](id, label string, getter func(T) any) *Monitor[T] {
	return &Monitor[T]{
		ID: id, Label: label,
		getter: func(target T) (any, error) { return getter(target), nil },
	}
}

func NewMonitorFunc[T any](id, label string, getter func(T) (any, error)) *Monitor[T] {
	return &Monitor[T]{ID: id, Label: label, getter: getter}
}

// Hint sets the optional renderer preference (for example "tree" or "table").
func (m *Monitor[T]) Hint(renderHint string) *Monitor[T] {
	m.RenderHint = renderHint
	return m
}

func (m *Monitor[T]) Metadata() *protocol.MonitorMetadata {
	metadata := &protocol.MonitorMetadata{ID: m.ID, Label: m.Label}
	if m.RenderHint != "" {
		hint := m.RenderHint
		metadata.RenderHint = &hint
	}
	return metadata
}

func (m *Monitor[T]) Value(target T) (any, error) {
	if m.getter == nil {
		return nil, nil
	}
	return m.getter(target)
}
