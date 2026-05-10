package binding

import (
	"fmt"
	"reflect"
	"strconv"
	"strings"
)

const defaultTagKey = "tensnap"

type TagOptions struct {
	TagKey       string
	Scope        string
	DefaultScope string
}

type TagOption func(*TagOptions)

func TagKey(key string) TagOption {
	return func(opts *TagOptions) {
		opts.TagKey = key
	}
}

func TagScope(scope string) TagOption {
	return func(opts *TagOptions) {
		opts.Scope = scope
	}
}

func TagDefaultScope(scope string) TagOption {
	return func(opts *TagOptions) {
		opts.DefaultScope = scope
	}
}

func applyTagOptions(options []TagOption) TagOptions {
	opts := TagOptions{
		TagKey: defaultTagKey,
	}
	for _, option := range options {
		option(&opts)
	}
	return opts
}

type compiledTagField struct {
	name    string
	options Options
	index   []int
	typ     reflect.Type
}

func compileTaggedFields(rootType reflect.Type, options TagOptions) ([]compiledTagField, error) {
	if rootType == nil {
		return nil, fmt.Errorf("binding: nil tag root type")
	}
	for rootType.Kind() == reflect.Pointer {
		rootType = rootType.Elem()
	}
	if rootType.Kind() != reflect.Struct {
		return nil, fmt.Errorf("binding: tag root must be a struct or pointer to struct, got %s", rootType.Kind())
	}
	return compileTaggedFieldsInType(rootType, nil, options)
}

func compileTaggedFieldsInType(rootType reflect.Type, parent []int, options TagOptions) ([]compiledTagField, error) {
	fields := make([]compiledTagField, 0)
	for index := range rootType.NumField() {
		field := rootType.Field(index)
		fieldIndex := appendIndex(parent, index)

		if field.Anonymous {
			embedded := field.Type
			for embedded.Kind() == reflect.Pointer {
				embedded = embedded.Elem()
			}
			if embedded.Kind() == reflect.Struct {
				embeddedFields, err := compileTaggedFieldsInType(embedded, fieldIndex, options)
				if err != nil {
					return nil, err
				}
				fields = append(fields, embeddedFields...)
			}
		}

		raw, ok := field.Tag.Lookup(options.TagKey)
		if !ok {
			continue
		}
		tags, err := parseTagEntries(raw)
		if err != nil {
			return nil, fmt.Errorf("field %s: %w", field.Name, err)
		}
		for _, tag := range tags {
			if tag.HasArg("-") {
				continue
			}
			scope := tag.Key("scope")
			if scope == "" {
				scope = options.DefaultScope
			}
			if scope != options.Scope {
				continue
			}
			name := tagName(tag)
			if name == "" {
				continue
			}
			fields = append(fields, compiledTagField{
				name:    name,
				options: tag,
				index:   fieldIndex,
				typ:     field.Type,
			})
		}
	}
	return fields, nil
}

func parseTagEntries(raw string) ([]Options, error) {
	if raw == "" {
		return nil, nil
	}
	parts := splitTagEntries(raw)
	entries := make([]Options, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		options, err := ParseTag(part)
		if err != nil {
			return nil, err
		}
		entries = append(entries, options)
	}
	return entries, nil
}

func splitTagEntries(raw string) []string {
	parts := make([]string, 0, 1)
	start := 0
	quote := rune(0)
	escaped := false
	for index, r := range raw {
		if escaped {
			escaped = false
			continue
		}
		if r == '\\' {
			escaped = true
			continue
		}
		if quote != 0 {
			if r == quote {
				quote = 0
			}
			continue
		}
		switch r {
		case '\'', '"':
			quote = r
		case ';':
			parts = append(parts, raw[start:index])
			start = index + len(string(r))
		}
	}
	parts = append(parts, raw[start:])
	return parts
}

func tagName(options Options) string {
	for _, key := range []string{"name", "id", "field"} {
		if value := options.Key(key); value != "" {
			return value
		}
	}
	return options.Arg(0)
}

func typeOfValue[T any]() reflect.Type {
	var zero T
	typ := reflect.TypeOf(zero)
	if typ != nil {
		return typ
	}
	return reflect.TypeOf((*T)(nil)).Elem()
}

func fieldValue(root any, field compiledTagField) (reflect.Value, error) {
	value := reflect.ValueOf(root)
	if !value.IsValid() {
		return reflect.Value{}, fmt.Errorf("binding: nil tag root")
	}
	for value.Kind() == reflect.Pointer {
		if value.IsNil() {
			return reflect.Value{}, fmt.Errorf("binding: nil pointer in tag root")
		}
		value = value.Elem()
	}
	return value.FieldByIndex(field.index), nil
}

func fieldAny(root any, field compiledTagField) (any, error) {
	value, err := fieldValue(root, field)
	if err != nil {
		return nil, err
	}
	if !value.CanInterface() {
		return nil, fmt.Errorf("binding: field %q is not exported", field.name)
	}
	return value.Interface(), nil
}

func setFieldAny(root any, field compiledTagField, raw any) error {
	value, err := fieldValue(root, field)
	if err != nil {
		return err
	}
	if !value.CanSet() {
		return fmt.Errorf("binding: field %q is not settable; pass a pointer root", field.name)
	}
	converted, err := convertValue(raw, value.Type())
	if err != nil {
		return fmt.Errorf("binding: field %q: %w", field.name, err)
	}
	value.Set(converted)
	return nil
}

func convertValue(raw any, target reflect.Type) (reflect.Value, error) {
	if raw == nil {
		return reflect.Zero(target), nil
	}
	value := reflect.ValueOf(raw)
	if value.IsValid() && value.Type().AssignableTo(target) {
		return value, nil
	}
	if value.IsValid() && value.Type().ConvertibleTo(target) {
		return value.Convert(target), nil
	}
	switch target.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		f, ok := asFloat(raw)
		if !ok {
			return reflect.Value{}, fmt.Errorf("expected numeric value")
		}
		return reflect.ValueOf(int64(f)).Convert(target), nil
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		f, ok := asFloat(raw)
		if !ok {
			return reflect.Value{}, fmt.Errorf("expected numeric value")
		}
		return reflect.ValueOf(uint64(f)).Convert(target), nil
	case reflect.Float32, reflect.Float64:
		f, ok := asFloat(raw)
		if !ok {
			return reflect.Value{}, fmt.Errorf("expected numeric value")
		}
		return reflect.ValueOf(f).Convert(target), nil
	case reflect.Bool:
		b, ok := raw.(bool)
		if !ok {
			return reflect.Value{}, fmt.Errorf("expected bool value")
		}
		return reflect.ValueOf(b), nil
	case reflect.String:
		s, ok := raw.(string)
		if !ok {
			return reflect.Value{}, fmt.Errorf("expected string value")
		}
		return reflect.ValueOf(s), nil
	default:
		return reflect.Value{}, fmt.Errorf("cannot convert %T to %s", raw, target)
	}
}

func asFloat(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int8:
		return float64(v), true
	case int16:
		return float64(v), true
	case int32:
		return float64(v), true
	case int64:
		return float64(v), true
	case uint:
		return float64(v), true
	case uint8:
		return float64(v), true
	case uint16:
		return float64(v), true
	case uint32:
		return float64(v), true
	case uint64:
		return float64(v), true
	default:
		return 0, false
	}
}

func parseTagFloat(options Options, key string, fallback float64) (float64, error) {
	raw, ok := options.KeyLookup(key)
	if !ok || raw == "" {
		return fallback, nil
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid %s=%q", key, raw)
	}
	return value, nil
}

func parseTagBool(options Options, key string, fallback bool) (bool, error) {
	raw, ok := options.KeyLookup(key)
	if !ok || raw == "" {
		return fallback, nil
	}
	value, err := strconv.ParseBool(raw)
	if err != nil {
		return false, fmt.Errorf("invalid %s=%q", key, raw)
	}
	return value, nil
}

func parseTagStringList(options Options, key string) []string {
	raw := options.Key(key)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, "|")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}
