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
type TargetedEmissiveActionInvoker[T any] func(T, *protocol.ActionTarget, map[string]any, abm.Emitter) (bool, error)

type Action[T any] struct {
	ID              string
	Label           string
	Continuous      *bool
	Scope           *string
	Kwargs          []protocol.ActionKwargDefinition
	Invoker         EmissiveActionInvoker[T]
	TargetedInvoker TargetedEmissiveActionInvoker[T]
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
		ID:      id,
		Label:   label,
		Invoker: wrappedInvoker,
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
		ID:         id,
		Label:      label,
		Continuous: abm.BoolPtr(true),
		Invoker:    wrappedInvoker,
	}
}

func NewEmissiveAction[T any](
	id string,
	label string,
	invoker EmissiveActionInvoker[T],
) *Action[T] {
	return &Action[T]{
		ID:      id,
		Label:   label,
		Invoker: invoker,
	}
}

// Targeted installs a target/kwargs-aware invoker and declares the canonical
// action scope. A nil target is rejected for any non-model scope.
func (a *Action[T]) Targeted(scope string, kwargs []protocol.ActionKwargDefinition, invoker TargetedEmissiveActionInvoker[T]) *Action[T] {
	a.Scope = &scope
	a.Kwargs = append([]protocol.ActionKwargDefinition(nil), kwargs...)
	a.TargetedInvoker = invoker
	return a
}

func fireActionRaw[T any](e abm.Emitter, action *Action[T], target T, payload *protocol.ActionInvokePayload) (*protocol.ActionResultPayload, error) {
	if payload == nil {
		return nil, fmt.Errorf("nil action payload")
	}
	result := false
	var err error
	if action.Scope != nil && *action.Scope != "model" {
		if payload.Target == nil || payload.Target.Type != *action.Scope {
			return &protocol.ActionResultPayload{ID: action.ID, RequestID: payload.RequestID, Error: &protocol.ActionExecutionError{Code: "invalid_target", Message: "action target does not match declared scope"}}, nil
		}
	}
	kwargs, validationErr := validateKwargs(action.Kwargs, payload.Kwargs)
	if validationErr != nil {
		return &protocol.ActionResultPayload{ID: action.ID, RequestID: payload.RequestID, Error: validationErr}, nil
	}
	if action.TargetedInvoker != nil {
		result, err = action.TargetedInvoker(target, payload.Target, kwargs, e)
	} else {
		result, err = action.Invoker(target, e)
	}
	if err != nil {
		return &protocol.ActionResultPayload{ID: action.ID, RequestID: payload.RequestID, Error: &protocol.ActionExecutionError{Code: "handler_error", Message: err.Error()}}, nil
	}
	if payload.Continuous == nil || !*payload.Continuous {
		result = false
	}
	return &protocol.ActionResultPayload{
		ID:             action.ID,
		RequestID:      payload.RequestID,
		ShouldContinue: &result,
	}, nil
}

func fireTimedActionRaw[T any](e abm.Emitter, action *Action[T], target T, payload *protocol.ActionInvokePayload) (*protocol.ActionResultPayload, error) {
	started := time.Now()
	ret, err := fireActionRaw(e, action, target, payload)
	if err != nil {
		return nil, err
	}
	simulateMS := float64(time.Since(started).Milliseconds())
	ret.Timings = &protocol.ActionEndTimings{SimulateMS: &simulateMS}
	return ret, nil
}

func validateKwargs(definitions []protocol.ActionKwargDefinition, supplied map[string]any) (map[string]any, *protocol.ActionExecutionError) {
	// The normal playback actions have neither declared kwargs nor supplied
	// kwargs. Avoid allocating two maps on every continuous tick.
	if len(definitions) == 0 {
		if len(supplied) == 0 {
			return nil, nil
		}
		for name := range supplied {
			return nil, &protocol.ActionExecutionError{Code: "invalid_kwargs", Message: "unknown action kwarg: " + name}
		}
	}
	if supplied == nil {
		supplied = map[string]any{}
	}
	known := make(map[string]protocol.ActionKwargDefinition, len(definitions))
	for _, definition := range definitions {
		known[definition.Name] = definition
	}
	for name := range supplied {
		if _, ok := known[name]; !ok {
			return nil, &protocol.ActionExecutionError{Code: "invalid_kwargs", Message: "unknown action kwarg: " + name}
		}
	}
	result := make(map[string]any, len(definitions))
	for _, definition := range definitions {
		value, exists := supplied[definition.Name]
		if !exists {
			if definition.Required != nil && *definition.Required {
				return nil, &protocol.ActionExecutionError{Code: "invalid_kwargs", Message: "missing action kwarg: " + definition.Name}
			}
			if definition.Default != nil {
				result[definition.Name] = definition.Default
			}
			continue
		}
		valid := definition.Type == "json" ||
			(definition.Type == "string" && isString(value)) ||
			(definition.Type == "boolean" && isBool(value)) ||
			(definition.Type == "integer" && isInteger(value)) ||
			(definition.Type == "number" && isNumber(value)) ||
			(definition.Type == "enum" && isAllowedEnum(value, definition.Options))
		if !valid {
			return nil, &protocol.ActionExecutionError{Code: "invalid_kwargs", Message: "invalid action kwarg: " + definition.Name}
		}
		if (definition.Type == "number" || definition.Type == "integer") && !inRange(value, definition.Min, definition.Max) {
			return nil, &protocol.ActionExecutionError{Code: "invalid_kwargs", Message: "action kwarg out of range: " + definition.Name}
		}
		result[definition.Name] = value
	}
	return result, nil
}

func isString(value any) bool { _, ok := value.(string); return ok }
func isBool(value any) bool   { _, ok := value.(bool); return ok }
func isNumber(value any) bool { _, ok := abm.AsFloat64(value); return ok }
func isInteger(value any) bool {
	switch value.(type) {
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return true
	}
	return false
}
func isAllowedEnum(value any, options []string) bool {
	s, ok := value.(string)
	return ok && containsString(options, s)
}
func inRange(value any, min, max *float64) bool {
	f, ok := abm.AsFloat64(value)
	if !ok {
		return false
	}
	return (min == nil || f >= *min) && (max == nil || f <= *max)
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

func (r *BindingActionRouter[T]) fire(e abm.Emitter, payload *protocol.ActionInvokePayload) error {
	action, ok := r.actions[payload.ID]
	if !ok {
		return fmt.Errorf("invalid action id: %s", payload.ID)
	}
	ret, err := fireActionRaw(e, action, r.target, payload)
	if err != nil {
		return err
	}
	return e.ActionResult(ret)
}

func (r *BindingActionRouter[T]) fireTimed(e abm.Emitter, payload *protocol.ActionInvokePayload) error {
	action, ok := r.actions[payload.ID]
	if !ok {
		return fmt.Errorf("invalid action id: %s", payload.ID)
	}
	ret, err := fireTimedActionRaw(e, action, r.target, payload)
	if err != nil {
		return err
	}
	return e.ActionResult(ret)
}

func (r *BindingActionRouter[T]) Dispatch(
	e abm.Emitter,
	payload *protocol.ActionInvokePayload,
) (handled bool, err error) {
	if payload == nil || !r.Has(payload.ID) {
		return false, nil
	}
	if r.timed {
		return true, r.fireTimed(e, payload)
	}
	return true, r.fire(e, payload)
}

func (r *BindingActionRouter[T]) BuildState() []*protocol.Action {
	ret := make([]*protocol.Action, 0, len(r.actions))
	for _, a := range r.actions {
		ret = append(ret, &protocol.Action{
			ID:         a.ID,
			Label:      a.Label,
			Scope:      a.Scope,
			Kwargs:     append([]protocol.ActionKwargDefinition(nil), a.Kwargs...),
			Continuous: a.Continuous,
		})
	}
	return ret
}

// #endregion
