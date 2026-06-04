package binding

import "github.com/billstark001/tensnap/packages/tensnap-go/protocol"

type ChartSeries[T any] struct {
	ID     string
	Label  string
	Color  string
	getter func(T) (any, error)
}

type Chart[T any] struct {
	ID     string
	Label  string
	Color  string
	getter func(T) (any, error)
	series []ChartSeries[T]
}

func NewChartSeries[T any](id, label, color string, getter func(T) any) ChartSeries[T] {
	return ChartSeries[T]{
		ID:    id,
		Label: label,
		Color: color,
		getter: func(target T) (any, error) {
			return getter(target), nil
		},
	}
}

func NewChartSeriesFunc[T any](id, label, color string, getter func(T) (any, error)) ChartSeries[T] {
	return ChartSeries[T]{
		ID:     id,
		Label:  label,
		Color:  color,
		getter: getter,
	}
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

func NewChartGroup[T any](id, label string, series ...ChartSeries[T]) *Chart[T] {
	return &Chart[T]{
		ID:     id,
		Label:  label,
		series: append([]ChartSeries[T]{}, series...),
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
	meta := &protocol.ChartGroupMetadata{
		ID:    c.ID,
		Label: c.Label,
		Color: &color,
	}
	if len(c.series) > 0 {
		meta.DataList = make([]protocol.ChartMetadata, 0, len(c.series))
		for _, series := range c.series {
			seriesColor := series.Color
			meta.DataList = append(meta.DataList, protocol.ChartMetadata{
				ID:    series.ID,
				Label: series.Label,
				Color: &seriesColor,
			})
		}
	}
	return meta
}

func (c *Chart[T]) Value(target T) (any, error) {
	if len(c.series) > 0 {
		values := make(map[string]any, len(c.series))
		for _, series := range c.series {
			value, err := series.Value(target)
			if err != nil {
				return nil, err
			}
			values[series.ID] = value
		}
		return values, nil
	}
	if c.getter == nil {
		return nil, nil
	}
	return c.getter(target)
}

func (c *Chart[T]) Updates(target T, tick float64) ([]protocol.ChartUpdateEntry, error) {
	if len(c.series) == 0 {
		value, err := c.Value(target)
		if err != nil {
			return nil, err
		}
		return []protocol.ChartUpdateEntry{{
			ID:    c.ID,
			Time:  &tick,
			Value: value,
		}}, nil
	}

	updates := make([]protocol.ChartUpdateEntry, 0, len(c.series))
	for _, series := range c.series {
		value, err := series.Value(target)
		if err != nil {
			return nil, err
		}
		updates = append(updates, protocol.ChartUpdateEntry{
			ID:    series.ID,
			Time:  &tick,
			Value: value,
		})
	}
	return updates, nil
}

func (s ChartSeries[T]) Metadata() protocol.ChartMetadata {
	color := s.Color
	return protocol.ChartMetadata{
		ID:    s.ID,
		Label: s.Label,
		Color: &color,
	}
}

func (s ChartSeries[T]) Value(target T) (any, error) {
	if s.getter == nil {
		return nil, nil
	}
	return s.getter(target)
}
