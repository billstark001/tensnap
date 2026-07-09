package abm

import (
	"fmt"

	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

// ScenarioEnvironment declares one environment and its layers.
type ScenarioEnvironment struct {
	ID     string
	Type   string
	Layers []*protocol.EnvLayerCreatePayload
}

// Scenario is a declarative description of a model's stable protocol surface.
// Base defaults can replay it during Setup and state_sync.
type Scenario struct {
	Params      []*ParamMetadata
	Actions     []*protocol.Action
	Envs        []ScenarioEnvironment
	Charts      []*protocol.ChartGroupMetadata
	ReplayState func(e Emitter) error

	paramByID map[string]*ParamMetadata
	aliasToID map[string]string
}

// NewScenario returns an empty declarative scenario.
func NewScenario() *Scenario {
	return &Scenario{}
}

// WithParams appends parameter metadata to the scenario.
func (s *Scenario) WithParams(params ...*ParamMetadata) *Scenario {
	s.Params = append(s.Params, params...)
	s.paramByID = nil
	s.aliasToID = nil
	return s
}

// WithActions appends renderer-visible actions.
func (s *Scenario) WithActions(actions ...*protocol.Action) *Scenario {
	s.Actions = append(s.Actions, actions...)
	return s
}

// WithEnvs appends environment declarations.
func (s *Scenario) WithEnvs(envs ...ScenarioEnvironment) *Scenario {
	s.Envs = append(s.Envs, envs...)
	return s
}

// WithCharts appends chart declarations.
func (s *Scenario) WithCharts(charts ...*protocol.ChartGroupMetadata) *Scenario {
	s.Charts = append(s.Charts, charts...)
	return s
}

// WithStateReplay sets the callback used to replay current runtime state.
func (s *Scenario) WithStateReplay(fn func(e Emitter) error) *Scenario {
	s.ReplayState = fn
	return s
}

func (s *Scenario) ensureParamIndex() error {
	if s == nil || s.paramByID != nil {
		return nil
	}
	s.paramByID = make(map[string]*ParamMetadata, len(s.Params))
	s.aliasToID = make(map[string]string)
	for _, meta := range s.Params {
		id, err := meta.canonicalID()
		if err != nil {
			return err
		}
		if _, exists := s.paramByID[id]; exists {
			return fmt.Errorf("tensnap: duplicate parameter metadata %q", id)
		}
		s.paramByID[id] = meta
		for _, alias := range meta.Aliases {
			if _, exists := s.aliasToID[alias]; exists {
				return fmt.Errorf("tensnap: duplicate parameter alias %q", alias)
			}
			s.aliasToID[alias] = id
		}
	}
	return nil
}

func (s *Scenario) resolveParam(id string) (*ParamMetadata, string, bool) {
	meta, ok := s.paramByID[id]
	if ok {
		return meta, id, true
	}
	canonicalID, aliased := s.aliasToID[id]
	if !aliased {
		return nil, "", false
	}
	return s.paramByID[canonicalID], canonicalID, true
}

// SeedParams populates Base parameter storage from the scenario's current metadata values.
func (s *Scenario) SeedParams(base *Base) error {
	if s == nil {
		return nil
	}
	if err := s.ensureParamIndex(); err != nil {
		return err
	}
	for id, meta := range s.paramByID {
		value, err := meta.value()
		if err != nil {
			return err
		}
		base.SetParam(id, value)
	}
	return nil
}

// ApplyParam resolves id against parameter metadata and stores the normalized value in Base.
// It returns handled=false when the scenario has no matching metadata for id.
func (s *Scenario) ApplyParam(base *Base, id string, value any) (bool, error) {
	if s == nil {
		return false, nil
	}
	if err := s.ensureParamIndex(); err != nil {
		return true, err
	}
	meta, _, ok := s.resolveParam(id)
	if !ok {
		return false, nil
	}
	return true, meta.apply(base, value)
}

// ParamValue returns the current canonical value for id or one of its aliases.
func (s *Scenario) ParamValue(id string) (any, bool, error) {
	if s == nil {
		return nil, false, nil
	}
	if err := s.ensureParamIndex(); err != nil {
		return nil, true, err
	}
	meta, _, ok := s.resolveParam(id)
	if !ok {
		return nil, false, nil
	}
	value, err := meta.value()
	return value, true, err
}

// Replay emits all declarative creates and then calls ReplayState, if set.
func (s *Scenario) Replay(e Emitter) error {
	if s == nil {
		return nil
	}
	if err := s.ensureParamIndex(); err != nil {
		return err
	}
	for _, meta := range s.Params {
		if err := meta.replay(e); err != nil {
			return err
		}
	}
	for _, action := range s.Actions {
		if err := e.ActionCreate(action); err != nil {
			return err
		}
	}
	for _, env := range s.Envs {
		if err := e.EnvCreate(env.ID, env.Type); err != nil {
			return err
		}
		for _, layer := range env.Layers {
			if err := e.EnvLayerCreate(layer); err != nil {
				return err
			}
		}
	}
	for _, chart := range s.Charts {
		if err := e.ChartCreate(chart); err != nil {
			return err
		}
	}
	if s.ReplayState != nil {
		return s.ReplayState(e)
	}
	return nil
}
