package binding

import "fmt"

type ItemFieldFunc[T any, I any] func(T, I) any

func Const[T any, I any](value any) ItemFieldFunc[T, I] {
	return func(T, I) any {
		return value
	}
}

func ProjectTags[T any, I any](options ...TagOption) func(T, I) map[string]any {
	projector, err := compileTagProjector[T, I](nil, options...)
	if err != nil {
		panic(err)
	}
	return projector
}

func ProjectTagsRequired[T any, I any](required []string, options ...TagOption) func(T, I) map[string]any {
	projector, err := compileTagProjector[T, I](required, options...)
	if err != nil {
		panic(err)
	}
	return projector
}

func compileTagProjector[T any, I any](required []string, options ...TagOption) (func(T, I) map[string]any, error) {
	tagOptions := applyTagOptions(options)
	if tagOptions.Scope == "" {
		tagOptions.Scope = "agent"
	}
	if tagOptions.DefaultScope == "" {
		tagOptions.DefaultScope = tagOptions.Scope
	}
	fields, err := compileTaggedFields(typeOfValue[I](), tagOptions)
	if err != nil {
		return nil, err
	}
	seen := make(map[string]struct{}, len(fields))
	for _, field := range fields {
		seen[field.name] = struct{}{}
	}
	for _, name := range required {
		if _, ok := seen[name]; !ok {
			return nil, fmt.Errorf("binding: missing required tagged field %q", name)
		}
	}
	return func(_ T, item I) map[string]any {
		out := make(map[string]any, len(fields))
		for _, field := range fields {
			value, err := fieldAny(item, field)
			if err != nil {
				panic(err)
			}
			out[field.name] = value
		}
		return out
	}, nil
}

func composeProjector[T any, I any](
	base func(T, I) map[string]any,
	fields map[string]ItemFieldFunc[T, I],
) func(T, I) map[string]any {
	return func(target T, item I) map[string]any {
		out := map[string]any{}
		if base != nil {
			for key, value := range base(target, item) {
				out[key] = value
			}
		}
		for key, field := range fields {
			out[key] = field(target, item)
		}
		return out
	}
}
