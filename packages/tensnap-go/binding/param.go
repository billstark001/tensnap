package binding

import (
	"fmt"
	"reflect"
	"strings"

	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

type Param[T any] struct {
	ID                 string
	Label              string
	Aliases            []string
	AllowRuntimeChange *bool

	get func(T) any
	set func(T, any) error

	definition func(T, *Param[T]) any
	normalize  func(any) (any, error)
}

func NumberParam[T any](id, label string, getter func(T) float64, setter func(T, float64) error) *NumberParamBuilder[T] {
	return &NumberParamBuilder[T]{
		param: &Param[T]{
			ID:    id,
			Label: label,
			get: func(target T) any {
				return getter(target)
			},
			set: func(target T, value any) error {
				f, ok := abm.AsFloat64(value)
				if !ok {
					return fmt.Errorf("tensnap: expected numeric parameter %q", id)
				}
				return setter(target, f)
			},
		},
		min:  0,
		max:  1,
		step: 0.1,
	}
}

type NumberParamBuilder[T any] struct {
	param *Param[T]
	min   float64
	max   float64
	step  float64
}

func (b *NumberParamBuilder[T]) Range(minValue, maxValue float64) *NumberParamBuilder[T] {
	b.min = minValue
	b.max = maxValue
	return b
}

func (b *NumberParamBuilder[T]) Step(step float64) *NumberParamBuilder[T] {
	b.step = step
	return b
}

func (b *NumberParamBuilder[T]) Runtime(allow bool) *NumberParamBuilder[T] {
	b.param.AllowRuntimeChange = abm.BoolPtr(allow)
	return b
}

func (b *NumberParamBuilder[T]) Alias(aliases ...string) *NumberParamBuilder[T] {
	b.param.Aliases = append(b.param.Aliases, aliases...)
	return b
}

func (b *NumberParamBuilder[T]) Normalize(fn func(float64) (float64, error)) *NumberParamBuilder[T] {
	b.param.normalize = func(value any) (any, error) {
		f, ok := abm.AsFloat64(value)
		if !ok {
			return nil, fmt.Errorf("tensnap: expected numeric parameter %q", b.param.ID)
		}
		return fn(f)
	}
	return b
}

func (b *NumberParamBuilder[T]) Clamp() *NumberParamBuilder[T] {
	return b.Normalize(func(value float64) (float64, error) {
		return abm.ClampFloat(value, b.min, b.max), nil
	})
}

func (b *NumberParamBuilder[T]) Build() *Param[T] {
	if b.param.normalize == nil {
		b.Clamp()
	}
	b.param.definition = func(target T, param *Param[T]) any {
		value, _ := abm.AsFloat64(param.get(target))
		return protocol.NumberParameter{
			ID:                 param.ID,
			Type:               "number",
			Label:              param.Label,
			Value:              abm.ClampFloat(value, b.min, b.max),
			Min:                b.min,
			Max:                b.max,
			Step:               b.step,
			AllowRuntimeChange: param.AllowRuntimeChange,
		}
	}
	return b.param
}

func (p *Param[T]) Metadata(target T) *abm.ParamMetadata {
	return &abm.ParamMetadata{
		ID:         p.ID,
		Aliases:    append([]string(nil), p.Aliases...),
		Definition: p.definition(target, p),
		Normalize:  p.normalize,
		OnSet: func(value any) error {
			if p.set == nil {
				return nil
			}
			return p.set(target, value)
		},
	}
}

func ParamsFromTags[T any, R any](root func(T) R, options ...TagOption) ([]*Param[T], error) {
	tagOptions := applyTagOptions(options)
	if tagOptions.Scope == "" {
		tagOptions.Scope = "param"
	}
	if tagOptions.DefaultScope == "" {
		tagOptions.DefaultScope = tagOptions.Scope
	}
	rootType := typeOfValue[R]()
	fields, err := compileTaggedFields(rootType, tagOptions)
	if err != nil {
		return nil, err
	}
	params := make([]*Param[T], 0, len(fields))
	for _, field := range fields {
		param, err := paramFromTagField(root, field)
		if err != nil {
			return nil, err
		}
		params = append(params, param)
	}
	return params, nil
}

func MustParamsFromTags[T any, R any](root func(T) R, options ...TagOption) []*Param[T] {
	params, err := ParamsFromTags(root, options...)
	if err != nil {
		panic(err)
	}
	return params
}

func paramFromTagField[T any, R any](root func(T) R, field compiledTagField) (*Param[T], error) {
	label := field.options.Key("label")
	if label == "" {
		label = strings.ReplaceAll(field.name, "_", " ")
	}
	allowRuntimeChange, err := parseTagBool(field.options, "runtime", true)
	if err != nil {
		return nil, err
	}
	param := &Param[T]{
		ID:                 field.name,
		Label:              label,
		Aliases:            parseTagStringList(field.options, "aliases"),
		AllowRuntimeChange: abm.BoolPtr(allowRuntimeChange),
		get: func(target T) any {
			value, err := fieldAny(root(target), field)
			if err != nil {
				panic(err)
			}
			return value
		},
		set: func(target T, value any) error {
			return setFieldAny(root(target), field, value)
		},
	}

	switch numericKind(field.typ) {
	case true:
		minValue, err := parseTagFloat(field.options, "min", 0)
		if err != nil {
			return nil, err
		}
		maxValue, err := parseTagFloat(field.options, "max", 1)
		if err != nil {
			return nil, err
		}
		step, err := parseTagFloat(field.options, "step", 0.1)
		if err != nil {
			return nil, err
		}
		param.normalize = func(value any) (any, error) {
			f, ok := abm.AsFloat64(value)
			if !ok {
				return nil, fmt.Errorf("tensnap: expected numeric parameter %q", field.name)
			}
			return abm.ClampFloat(f, minValue, maxValue), nil
		}
		param.definition = func(target T, param *Param[T]) any {
			value, _ := abm.AsFloat64(param.get(target))
			return protocol.NumberParameter{
				ID:                 param.ID,
				Type:               "number",
				Label:              param.Label,
				Value:              abm.ClampFloat(value, minValue, maxValue),
				Min:                minValue,
				Max:                maxValue,
				Step:               step,
				AllowRuntimeChange: param.AllowRuntimeChange,
			}
		}
	case field.typ.Kind() == reflect.Bool:
		param.normalize = func(value any) (any, error) {
			if _, ok := value.(bool); !ok {
				return nil, fmt.Errorf("tensnap: expected bool parameter %q", field.name)
			}
			return value, nil
		}
		param.definition = func(target T, param *Param[T]) any {
			value, _ := param.get(target).(bool)
			return protocol.BooleanParameter{
				ID:                 param.ID,
				Type:               "boolean",
				Label:              param.Label,
				Value:              value,
				AllowRuntimeChange: param.AllowRuntimeChange,
			}
		}
	case field.typ.Kind() == reflect.String:
		param.normalize = func(value any) (any, error) {
			if _, ok := value.(string); !ok {
				return nil, fmt.Errorf("tensnap: expected string parameter %q", field.name)
			}
			return value, nil
		}
		param.definition = func(target T, param *Param[T]) any {
			value, _ := param.get(target).(string)
			return protocol.StringParameter{
				ID:                 param.ID,
				Type:               "string",
				Label:              param.Label,
				Value:              value,
				AllowRuntimeChange: param.AllowRuntimeChange,
			}
		}
	default:
		return nil, fmt.Errorf("binding: unsupported parameter field %q type %s", field.name, field.typ)
	}
	return param, nil
}

func numericKind(typ reflect.Type) bool {
	switch typ.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64,
		reflect.Float32, reflect.Float64:
		return true
	default:
		return false
	}
}
