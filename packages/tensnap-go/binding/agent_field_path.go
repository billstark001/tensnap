package binding

import (
	"fmt"
	"reflect"
	"regexp"
	"strconv"
	"strings"
)

var sourcePathPart = regexp.MustCompile(`^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+)$`)

func compileSourcePath(path string, defaultRoot string, allowed ...string) (string, []string) {
	normalized := strings.ReplaceAll(strings.ReplaceAll(path, "[", "."), "]", "")
	parts := strings.Split(normalized, ".")
	for _, part := range parts {
		if !sourcePathPart.MatchString(part) {
			panic(fmt.Sprintf("invalid source selector %q", path))
		}
	}
	root := defaultRoot
	for _, candidate := range allowed {
		if parts[0] == candidate {
			root, parts = candidate, parts[1:]
			break
		}
	}
	return root, parts
}

func readSourcePath(value any, parts []string) any {
	for _, part := range parts {
		current := reflect.ValueOf(value)
		for current.IsValid() && (current.Kind() == reflect.Pointer || current.Kind() == reflect.Interface) {
			if current.IsNil() {
				panic(fmt.Sprintf("nil source selector parent at %q", part))
			}
			current = current.Elem()
		}
		if !current.IsValid() {
			panic(fmt.Sprintf("missing source selector parent at %q", part))
		}
		switch current.Kind() {
		case reflect.Struct:
			current = current.FieldByName(part)
		case reflect.Map:
			key := reflect.ValueOf(part)
			if current.Type().Key().Kind() != reflect.String || !key.Type().ConvertibleTo(current.Type().Key()) {
				panic(fmt.Sprintf("source selector map key %q is not a string", part))
			}
			current = current.MapIndex(key.Convert(current.Type().Key()))
		case reflect.Array, reflect.Slice:
			index, err := strconv.Atoi(part)
			if err != nil || index < 0 || index >= current.Len() {
				panic(fmt.Sprintf("source selector index %q is out of bounds", part))
			}
			current = current.Index(index)
		default:
			panic(fmt.Sprintf("cannot select %q from %T", part, value))
		}
		if !current.IsValid() || !current.CanInterface() {
			panic(fmt.Sprintf("source selector field %q is unavailable", part))
		}
		value = current.Interface()
	}
	return value
}
