package binding

import "github.com/billstark001/tensnap/packages/tensnap-go/abm"

// projectionCopy separates projector detachment from publication detachment.
// Nil options select the safe default; explicit false opts out of that boundary.
type projectionCopy struct {
	builtin             bool
	copyInjectedValues  bool
	projectorOwnsValues *bool
	projectorDeepCopy   *bool
	deepCopy            *bool
}

func (p *projectionCopy) configureInjectedValues() {
	p.copyInjectedValues = !p.builtin && p.projectorOwnsValues != nil && *p.projectorOwnsValues && p.copiesProjection()
}

func (p *projectionCopy) copiesProjection() bool {
	return p.projectorDeepCopy == nil || *p.projectorDeepCopy
}

func (p *projectionCopy) copiesPublication() bool {
	if p.deepCopy != nil {
		return *p.deepCopy
	}
	if p.projectorOwnsValues != nil {
		return !*p.projectorOwnsValues
	}
	return !(p.builtin && p.copiesProjection())
}

func ownedProjector[T any, I any](raw func(T, I) map[string]any, p *projectionCopy) func(T, I) map[string]any {
	if raw == nil {
		return nil
	}
	copyValues := p.builtin && p.copiesProjection()
	if !copyValues {
		return raw
	}
	return func(model T, item I) map[string]any {
		record := raw(model, item)
		if copyValues {
			// Built-ins allocate the outer map; detach only its borrowed fields.
			for key, value := range record {
				record[key] = abm.SnapshotValue(value, true)
			}
		}
		return record
	}
}
