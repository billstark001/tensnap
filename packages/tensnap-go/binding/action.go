package binding

import (
	"fmt"
	"time"

	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

// #region Action

type ActionInvoker[T any] func(T) error
type ContinuousActionInvoker[T any] func(T) (bool, error)
type EmissiveActionInvoker[T any] func(T, abm.Emitter) (bool, error)

type Action[T any] struct {
	ID                 string
	Label              string
	Continuous         *bool
	AllowRuntimeChange *bool
	Invoker            EmissiveActionInvoker[T]
}

func NewAction[T any](
	id string,
	label string,
	invoker ActionInvoker[T],
) *Action[T] {
	var wrappedInvoker EmissiveActionInvoker[T] = func(t T, _ abm.Emitter) (bool, error) {
		return false, invoker(t)
	}
	return &Action[T]{
		ID:                 id,
		Label:              label,
		Continuous:         abm.BoolPtr(false),
		AllowRuntimeChange: abm.BoolPtr(false),
		Invoker:            wrappedInvoker,
	}
}

func NewContinuousAction[T any](
	id string,
	label string,
	invoker ContinuousActionInvoker[T],
) *Action[T] {
	var wrappedInvoker EmissiveActionInvoker[T] = func(t T, _ abm.Emitter) (bool, error) {
		return invoker(t)
	}
	return &Action[T]{
		ID:                 id,
		Label:              label,
		Continuous:         abm.BoolPtr(false),
		AllowRuntimeChange: abm.BoolPtr(false),
		Invoker:            wrappedInvoker,
	}
}

func NewEmissiveAction[T any](
	id string,
	label string,
	invoker EmissiveActionInvoker[T],
) *Action[T] {
	return &Action[T]{
		ID:                 id,
		Label:              label,
		Continuous:         abm.BoolPtr(false),
		AllowRuntimeChange: abm.BoolPtr(false),
		Invoker:            invoker,
	}
}

func fireActionRaw[T any](e abm.Emitter, action *Action[T], target T, tickID *string, continuous bool) (*protocol.ActionEndPayload, error) {
	result, err := action.Invoker(target, e)
	if err != nil {
		return nil, err
	}
	if !continuous {
		result = false
	}
	return &protocol.ActionEndPayload{
		ID:       action.ID,
		TickID:   tickID,
		Continue: &result,
	}, nil
}

func fireTimedActionRaw[T any](e abm.Emitter, action *Action[T], target T, tickID *string, continuous bool) (*protocol.ActionEndPayload, error) {
	started := time.Now()
	ret, err := fireActionRaw(e, action, target, tickID, continuous)
	if err != nil {
		return nil, err
	}
	simulateMS := float64(time.Since(started).Milliseconds())
	ret.Timings = &protocol.ActionEndTimings{SimulateMS: &simulateMS}
	return ret, nil
}

// #endregion

// #region Action Router

type BindingActionRouter[T any] struct {
	actions map[string]*Action[T]
	target  T
	timed   bool
}

func NewBindingActionRouter[T any](target T, timed bool) *BindingActionRouter[T] {
	return &BindingActionRouter[T]{
		actions: make(map[string]*Action[T]),
		target:  target,
		timed:   timed,
	}
}

func (r *BindingActionRouter[T]) Has(actionID string) bool {
	_, ok := r.actions[actionID]
	return ok
}

func (r *BindingActionRouter[T]) Set(action *Action[T]) {
	if action == nil {
		return
	}
	r.actions[action.ID] = action
}

func (r *BindingActionRouter[T]) fire(e abm.Emitter, actionID string, tickID *string, continuous bool) error {
	action, ok := r.actions[actionID]
	if !ok {
		return fmt.Errorf("invalid action id: %s", actionID)
	}
	ret, err := fireActionRaw(e, action, r.target, tickID, continuous)
	if err != nil {
		return err
	}
	return e.ActionEnd(ret)
}

func (r *BindingActionRouter[T]) fireTimed(e abm.Emitter, actionID string, tickID *string, continuous bool) error {
	action, ok := r.actions[actionID]
	if !ok {
		return fmt.Errorf("invalid action id: %s", actionID)
	}
	ret, err := fireTimedActionRaw(e, action, r.target, tickID, continuous)
	if err != nil {
		return err
	}
	return e.ActionEnd(ret)
}

func (r *BindingActionRouter[T]) Dispatch(
	e abm.Emitter,
	actionID string,
	tickID *string,
	continuous bool,
) (handled bool, err error) {
	if !r.Has(actionID) {
		return false, nil
	}
	if r.timed {
		return true, r.fireTimed(e, actionID, tickID, continuous)
	}
	return true, r.fire(e, actionID, tickID, continuous)
}

func (r *BindingActionRouter[T]) BuildState() []*protocol.Action {
	ret := make([]*protocol.Action, 0, len(r.actions))
	for _, a := range r.actions {
		ret = append(ret, &protocol.Action{
			ID:                 a.ID,
			Label:              a.Label,
			Continuous:         a.Continuous,
			AllowRuntimeChange: a.AllowRuntimeChange,
		})
	}
	return ret
}

// #endregion
