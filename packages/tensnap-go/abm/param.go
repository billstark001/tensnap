package abm

import (
	"fmt"

	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

// ParamMetadata describes one renderer-visible parameter and its runtime coercion.
// Normalize can clamp or convert raw payloads before they are stored in Base.
// OnSet can react to the final value, for example by updating cached runtime state.
type ParamMetadata struct {
	ID         string
	Aliases    []string
	Definition any
	Normalize  func(value any) (any, error)
	OnSet      func(value any) error
}

func (m *ParamMetadata) canonicalID() (string, error) {
	if m == nil {
		return "", fmt.Errorf("tensnap: nil param metadata")
	}
	if m.ID != "" {
		return m.ID, nil
	}
	switch p := m.Definition.(type) {
	case protocol.NumberParameter:
		return p.ID, nil
	case *protocol.NumberParameter:
		return p.ID, nil
	case protocol.EnumParameter:
		return p.ID, nil
	case *protocol.EnumParameter:
		return p.ID, nil
	case protocol.BooleanParameter:
		return p.ID, nil
	case *protocol.BooleanParameter:
		return p.ID, nil
	case protocol.StringParameter:
		return p.ID, nil
	case *protocol.StringParameter:
		return p.ID, nil
	default:
		return "", fmt.Errorf("tensnap: unsupported parameter definition %T", m.Definition)
	}
}

func (m *ParamMetadata) value() (any, error) {
	if m == nil {
		return nil, fmt.Errorf("tensnap: nil param metadata")
	}
	switch p := m.Definition.(type) {
	case protocol.NumberParameter:
		return p.Value, nil
	case *protocol.NumberParameter:
		return p.Value, nil
	case protocol.EnumParameter:
		return p.Value, nil
	case *protocol.EnumParameter:
		return p.Value, nil
	case protocol.BooleanParameter:
		return p.Value, nil
	case *protocol.BooleanParameter:
		return p.Value, nil
	case protocol.StringParameter:
		return p.Value, nil
	case *protocol.StringParameter:
		return p.Value, nil
	default:
		return nil, fmt.Errorf("tensnap: unsupported parameter definition %T", m.Definition)
	}
}

func (m *ParamMetadata) setValue(value any) error {
	switch p := m.Definition.(type) {
	case protocol.NumberParameter:
		f, ok := AsFloat64(value)
		if !ok {
			return fmt.Errorf("tensnap: expected numeric value for %q", p.ID)
		}
		p.Value = f
		m.Definition = p
	case *protocol.NumberParameter:
		f, ok := AsFloat64(value)
		if !ok {
			return fmt.Errorf("tensnap: expected numeric value for %q", p.ID)
		}
		p.Value = f
	case protocol.EnumParameter:
		s, ok := value.(string)
		if !ok {
			return fmt.Errorf("tensnap: expected string value for %q", p.ID)
		}
		p.Value = s
		m.Definition = p
	case *protocol.EnumParameter:
		s, ok := value.(string)
		if !ok {
			return fmt.Errorf("tensnap: expected string value for %q", p.ID)
		}
		p.Value = s
	case protocol.BooleanParameter:
		b, ok := value.(bool)
		if !ok {
			return fmt.Errorf("tensnap: expected bool value for %q", p.ID)
		}
		p.Value = b
		m.Definition = p
	case *protocol.BooleanParameter:
		b, ok := value.(bool)
		if !ok {
			return fmt.Errorf("tensnap: expected bool value for %q", p.ID)
		}
		p.Value = b
	case protocol.StringParameter:
		s, ok := value.(string)
		if !ok {
			return fmt.Errorf("tensnap: expected string value for %q", p.ID)
		}
		p.Value = s
		m.Definition = p
	case *protocol.StringParameter:
		s, ok := value.(string)
		if !ok {
			return fmt.Errorf("tensnap: expected string value for %q", p.ID)
		}
		p.Value = s
	default:
		return fmt.Errorf("tensnap: unsupported parameter definition %T", m.Definition)
	}
	return nil
}

func (m *ParamMetadata) replay(e Emitter) error {
	return e.ParamCreate(m.Definition)
}

func (m *ParamMetadata) apply(base *Base, value any) error {
	finalValue := value
	if m.Normalize != nil {
		normalized, err := m.Normalize(value)
		if err != nil {
			return err
		}
		finalValue = normalized
	}
	if m.OnSet != nil {
		if err := m.OnSet(finalValue); err != nil {
			return err
		}
	}
	if err := m.setValue(finalValue); err != nil {
		return err
	}
	id, err := m.canonicalID()
	if err != nil {
		return err
	}
	base.SetParam(id, finalValue)
	return nil
}
