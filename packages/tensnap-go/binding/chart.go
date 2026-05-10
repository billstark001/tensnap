package binding

import "github.com/billstark001/tensnap/packages/tensnap-go/protocol"

type Chart[T any] struct {
	ID     string
	Label  string
	Color  string
	getter func(T) (any, error)
}

func NewChart[T any](id, label, color string, getter func(T) any) *Chart[T] {
	return &Chart[T]{
		ID:    id,
		Label: label,
		Color: color,
		getter: func(target T) (any, error) {
			return getter(target), nil
		},
	}
}

func NewChartFunc[T any](id, label, color string, getter func(T) (any, error)) *Chart[T] {
	return &Chart[T]{
		ID:     id,
		Label:  label,
		Color:  color,
		getter: getter,
	}
}

func (c *Chart[T]) Metadata() *protocol.ChartGroupMetadata {
	color := c.Color
	return &protocol.ChartGroupMetadata{
		ID:    c.ID,
		Label: c.Label,
		Color: &color,
	}
}

func (c *Chart[T]) Value(target T) (any, error) {
	if c.getter == nil {
		return nil, nil
	}
	return c.getter(target)
}
