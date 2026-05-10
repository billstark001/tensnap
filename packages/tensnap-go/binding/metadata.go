package binding

func MetadataFromTags[T any, R any](root func(T) R, options ...TagOption) (func(T) map[string]any, error) {
	tagOptions := applyTagOptions(options)
	if tagOptions.Scope == "" {
		tagOptions.Scope = "metadata"
	}
	fields, err := compileTaggedFields(typeOfValue[R](), tagOptions)
	if err != nil {
		return nil, err
	}
	return func(target T) map[string]any {
		if len(fields) == 0 {
			return nil
		}
		rootValue := root(target)
		out := make(map[string]any, len(fields))
		for _, field := range fields {
			value, err := fieldAny(rootValue, field)
			if err != nil {
				panic(err)
			}
			out[field.name] = value
		}
		return out
	}, nil
}

func MustMetadataFromTags[T any, R any](root func(T) R, options ...TagOption) func(T) map[string]any {
	metadata, err := MetadataFromTags(root, options...)
	if err != nil {
		panic(err)
	}
	return metadata
}
