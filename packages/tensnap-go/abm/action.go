package abm

import "fmt"

// ActionHandler handles an incoming action_start.
type ActionHandler func(e Emitter, tickID *string, continuous bool) error

// ActionRouter provides a lightweight action dispatch table.
// Base.OnAction consults it first, then falls back to built-in init/step routing.
type ActionRouter struct {
	handlers map[string]ActionHandler
}

// NewActionRouter returns an empty router.
func NewActionRouter() *ActionRouter {
	return &ActionRouter{handlers: make(map[string]ActionHandler)}
}

// Handle registers fn for actionID.
func (r *ActionRouter) Handle(actionID string, fn ActionHandler) *ActionRouter {
	if r.handlers == nil {
		r.handlers = make(map[string]ActionHandler)
	}
	r.handlers[actionID] = fn
	return r
}

// Dispatch invokes the handler for actionID.
// It returns handled=false when no handler exists.
func (r *ActionRouter) Dispatch(
	e Emitter,
	actionID string,
	tickID *string,
	continuous bool,
) (handled bool, err error) {
	if r == nil {
		return false, nil
	}
	fn, ok := r.handlers[actionID]
	if !ok {
		return false, nil
	}
	if fn == nil {
		return true, fmt.Errorf("tensnap: nil action handler for %q", actionID)
	}
	return true, fn(e, tickID, continuous)
}
