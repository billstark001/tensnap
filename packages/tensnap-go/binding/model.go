package binding

import (
	"time"

	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

const (
	ActionIDStart = "start"
	ActionIDReset = "reset"
)

type InitFunc[T any] func(T) error
type StepFunc[T any] func(T) (bool, error)

// Model is a composable declarative adapter around an arbitrary Go model.
//
// Each registry is optional. Callers can use the whole adapter as an abm.Model,
// or keep using their own imperative model and call the registry helpers
// directly.
type Model[T any] struct {
	abm.Base
	abm.TickCounter

	target T

	initFn  InitFunc[T]
	stepFn  StepFunc[T]
	resetFn InitFunc[T]

	params []*Param[T]
	envs   []*Env[T]
	charts []*Chart[T]

	initialized bool
}

type ModelOption[T any] func(*Model[T])

func NewModel[T any](target T, opts ...ModelOption[T]) *Model[T] {
	model := &Model[T]{target: target}
	for _, opt := range opts {
		opt(model)
	}
	model.refreshScenario()
	return model
}

func WithInit[T any](fn InitFunc[T]) ModelOption[T] {
	return func(model *Model[T]) {
		model.initFn = fn
	}
}

func WithStep[T any](fn StepFunc[T]) ModelOption[T] {
	return func(model *Model[T]) {
		model.stepFn = fn
	}
}

func WithReset[T any](fn InitFunc[T]) ModelOption[T] {
	return func(model *Model[T]) {
		model.resetFn = fn
	}
}

func WithParams[T any](params ...*Param[T]) ModelOption[T] {
	return func(model *Model[T]) {
		model.params = append(model.params, params...)
	}
}

func WithEnvs[T any](envs ...*Env[T]) ModelOption[T] {
	return func(model *Model[T]) {
		model.envs = append(model.envs, envs...)
	}
}

func WithCharts[T any](charts ...*Chart[T]) ModelOption[T] {
	return func(model *Model[T]) {
		model.charts = append(model.charts, charts...)
	}
}

func (m *Model[T]) Setup(e abm.Emitter) error {
	if m.initialized {
		if err := m.deleteOwned(e); err != nil {
			return err
		}
	}
	if err := m.initialize(); err != nil {
		return err
	}
	m.refreshScenario()
	return m.ReplayScenario(e)
}

func (m *Model[T]) Step(e abm.Emitter) error {
	return m.stepAction(e, protocol.ActionIDStep, nil)
}

func (m *Model[T]) OnStateSync(e abm.Emitter, payload *protocol.StateSyncPayload) error {
	if !m.initialized {
		if err := m.initialize(); err != nil {
			return err
		}
		m.refreshScenario()
	}
	return m.Base.OnStateSync(e, payload)
}

func (m *Model[T]) OnParamChange(e abm.Emitter, id string, value any) error {
	m.refreshScenario()
	return m.Base.OnParamChange(e, id, value)
}

func (m *Model[T]) OnAction(e abm.Emitter, actionID string, tickID *string, continuous bool) error {
	switch actionID {
	case ActionIDStart:
		return m.stepAction(e, ActionIDStart, tickID)
	case ActionIDReset, protocol.ActionIDInit:
		return m.resetAction(e, actionID, tickID)
	default:
		return m.Base.OnAction(e, actionID, tickID, continuous)
	}
}

func (m *Model[T]) PushEnvDiffs(e abm.Emitter) error {
	for _, env := range m.envs {
		if err := env.PushDiffs(m.target, e); err != nil {
			return err
		}
	}
	return nil
}

func (m *Model[T]) PushCharts(e abm.Emitter, tick float64) error {
	if len(m.charts) == 0 {
		return nil
	}
	updates := make([]protocol.ChartUpdateEntry, 0, len(m.charts))
	for _, chart := range m.charts {
		value, err := chart.Value(m.target)
		if err != nil {
			return err
		}
		updates = append(updates, protocol.ChartUpdateEntry{
			ID:    chart.ID,
			Time:  &tick,
			Value: value,
		})
	}
	return e.ChartUpdate(&protocol.ChartUpdatePayload{Updates: updates})
}

func (m *Model[T]) initialize() error {
	m.ResetTick()
	for _, env := range m.envs {
		env.Reset()
	}
	if m.initFn != nil {
		if err := m.initFn(m.target); err != nil {
			return err
		}
	}
	m.initialized = true
	return nil
}

func (m *Model[T]) resetAction(e abm.Emitter, actionID string, tickID *string) error {
	if m.resetFn != nil {
		if err := m.deleteOwned(e); err != nil {
			return err
		}
		m.ResetTick()
		for _, env := range m.envs {
			env.Reset()
		}
		if err := m.resetFn(m.target); err != nil {
			return err
		}
		m.initialized = true
		m.refreshScenario()
		if err := m.ReplayScenario(e); err != nil {
			return err
		}
	} else if err := m.Setup(e); err != nil {
		return err
	}
	return e.ActionEnd(&protocol.ActionEndPayload{
		ID:       actionID,
		TickID:   tickID,
		Continue: abm.BoolPtr(false),
	})
}

func (m *Model[T]) stepAction(e abm.Emitter, actionID string, tickID *string) error {
	started := time.Now()
	if !m.initialized {
		if err := m.Setup(e); err != nil {
			return err
		}
	}
	cont := false
	if m.stepFn != nil {
		next, err := m.stepFn(m.target)
		if err != nil {
			return err
		}
		cont = next
	}
	if err := m.PushEnvDiffs(e); err != nil {
		return err
	}
	tick := float64(m.NextTick())
	if err := m.PushCharts(e, tick); err != nil {
		return err
	}
	if err := e.MetadataUpdate(&protocol.MetadataUpdatePayload{Time: &tick}); err != nil {
		return err
	}
	simulateMS := float64(time.Since(started).Milliseconds())
	return e.ActionEnd(&protocol.ActionEndPayload{
		ID:       actionID,
		TickID:   tickID,
		Continue: abm.BoolPtr(cont),
		Timings:  &protocol.ActionEndTimings{SimulateMS: &simulateMS},
	})
}

func (m *Model[T]) replayState(e abm.Emitter) error {
	for _, env := range m.envs {
		if err := env.ReplayState(m.target, e); err != nil {
			return err
		}
	}
	tick := float64(m.Tick())
	if err := m.PushCharts(e, tick); err != nil {
		return err
	}
	return e.MetadataUpdate(&protocol.MetadataUpdatePayload{Time: &tick})
}

func (m *Model[T]) refreshScenario() {
	scenario := abm.NewScenario().
		WithActions(
			&protocol.Action{ID: ActionIDReset, Label: "Reset", AllowRuntimeChange: abm.BoolPtr(true)},
			&protocol.Action{ID: ActionIDStart, Label: "Start", Continuous: abm.BoolPtr(true), AllowRuntimeChange: abm.BoolPtr(true)},
			&protocol.Action{ID: protocol.ActionIDStep, Label: "Step", AllowRuntimeChange: abm.BoolPtr(true)},
		).
		WithStateReplay(m.replayState)

	for _, param := range m.params {
		scenario.WithParams(param.Metadata(m.target))
	}
	for _, env := range m.envs {
		scenario.WithEnvs(env.Scenario(m.target))
	}
	for _, chart := range m.charts {
		scenario.WithCharts(chart.Metadata())
	}
	if err := m.SetScenario(scenario); err != nil {
		panic(err)
	}
}

func (m *Model[T]) deleteOwned(e abm.Emitter) error {
	for _, chart := range m.charts {
		if err := e.ChartDelete(chart.ID); err != nil {
			return err
		}
	}
	for _, env := range m.envs {
		if err := e.EnvDelete(env.ID); err != nil {
			return err
		}
	}
	return nil
}
