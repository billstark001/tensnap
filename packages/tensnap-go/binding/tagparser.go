package binding

import (
	"errors"
	"fmt"
	"reflect"
	"strings"
)

// Options represents one parsed tag value.
//
// It is similar to Python's args + kwargs model:
//
//	tag:"required,min=3,max=20"
//
// becomes:
//
//	Args:   ["required"]
//	Kwargs: {"min": "3", "max": "20"}
type Options struct {
	Raw    string
	Args   []string
	Kwargs map[string]string
}

// Arg returns the argument at index, or an empty string if it does not exist.
func (o Options) Arg(index int) string {
	if index < 0 || index >= len(o.Args) {
		return ""
	}
	return o.Args[index]
}

// ArgLookup returns the argument at index and whether it exists.
func (o Options) ArgLookup(index int) (string, bool) {
	if index < 0 || index >= len(o.Args) {
		return "", false
	}
	return o.Args[index], true
}

// Key returns the keyword value for key.
// If key does not exist, it returns an empty string.
func (o Options) Key(key string) string {
	if o.Kwargs == nil {
		return ""
	}
	return o.Kwargs[key]
}

// KeyLookup returns the keyword value for key and whether it exists.
func (o Options) KeyLookup(key string) (string, bool) {
	if o.Kwargs == nil {
		return "", false
	}
	v, ok := o.Kwargs[key]
	return v, ok
}

// HasArg reports whether arg exists in Args.
func (o Options) HasArg(arg string) bool {
	for _, item := range o.Args {
		if item == arg {
			return true
		}
	}
	return false
}

// TaggedField contains parsed tag information for one struct field.
type TaggedField struct {
	Name    string
	Index   []int
	Type    reflect.Type
	Tag     reflect.StructTag
	Options Options
}

// TaggedStruct contains parsed tag information for a struct type.
type TaggedStruct struct {
	Type   reflect.Type
	TagKey string

	Fields []TaggedField

	byName map[string]int
}

// LookupField returns parsed tag options by Go field name.
func (s *TaggedStruct) LookupField(name string) (Options, bool) {
	if s == nil || s.byName == nil {
		return Options{}, false
	}

	i, ok := s.byName[name]
	if !ok {
		return Options{}, false
	}

	return s.Fields[i].Options, true
}

// Parse parses the struct tags of obj using tagKey.
//
// obj may be a struct value or a pointer to a struct.
// Only fields containing tagKey are returned.
func Parse(obj any, tagKey string) (*TaggedStruct, error) {
	if tagKey == "" {
		return nil, errors.New("tag key cannot be empty")
	}

	t := reflect.TypeOf(obj)
	if t == nil {
		return nil, errors.New("obj cannot be nil")
	}

	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}

	if t.Kind() != reflect.Struct {
		return nil, fmt.Errorf("obj must be a struct or pointer to struct, got %s", t.Kind())
	}

	out := &TaggedStruct{
		Type:   t,
		TagKey: tagKey,
		byName: make(map[string]int),
	}

	if err := parseType(t, tagKey, nil, out); err != nil {
		return nil, err
	}

	return out, nil
}

// ParseTag parses a comma-separated tag value.
//
// Supported examples:
//
//	"required,min=3,max=20"
//	"required,pattern='a,b'"
//	`name,default="hello,world"`
//
// Commas inside quoted strings are not treated as separators.
func ParseTag(raw string) (Options, error) {
	opt := Options{
		Raw: raw,
	}

	if raw == "" {
		return opt, nil
	}

	start := 0
	quote := rune(0)
	escaped := false

	for i, r := range raw {
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
		case ',':
			if err := parseToken(raw[start:i], &opt); err != nil {
				return Options{}, err
			}
			start = i + len(string(r))
		}
	}

	if quote != 0 {
		return Options{}, errors.New("unclosed quote in tag")
	}

	if err := parseToken(raw[start:], &opt); err != nil {
		return Options{}, err
	}

	return opt, nil
}

func parseType(t reflect.Type, tagKey string, parentIndex []int, out *TaggedStruct) error {
	for i := 0; i < t.NumField(); i++ {
		sf := t.Field(i)

		index := appendIndex(parentIndex, i)

		// Recursively parse anonymous embedded structs.
		//
		// This mirrors common reflection behavior while keeping explicit
		// field tags on the embedded field itself.
		if sf.Anonymous {
			embeddedType := sf.Type
			for embeddedType.Kind() == reflect.Pointer {
				embeddedType = embeddedType.Elem()
			}

			if embeddedType.Kind() == reflect.Struct {
				if err := parseType(embeddedType, tagKey, index, out); err != nil {
					return err
				}
			}
		}

		raw, ok := sf.Tag.Lookup(tagKey)
		if !ok {
			continue
		}

		options, err := ParseTag(raw)
		if err != nil {
			return fmt.Errorf("field %s: %w", sf.Name, err)
		}

		out.byName[sf.Name] = len(out.Fields)
		out.Fields = append(out.Fields, TaggedField{
			Name:    sf.Name,
			Index:   index,
			Type:    sf.Type,
			Tag:     sf.Tag,
			Options: options,
		})
	}

	return nil
}

func parseToken(token string, opt *Options) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil
	}

	pos := indexUnquotedEqual(token)
	if pos < 0 {
		arg, err := unquote(strings.TrimSpace(token))
		if err != nil {
			return err
		}

		if arg != "" {
			opt.Args = append(opt.Args, arg)
		}

		return nil
	}

	key := strings.TrimSpace(token[:pos])
	value := strings.TrimSpace(token[pos+1:])

	if key == "" {
		return fmt.Errorf("empty keyword key in token %q", token)
	}

	key, err := unquote(key)
	if err != nil {
		return err
	}

	value, err = unquote(value)
	if err != nil {
		return err
	}

	if opt.Kwargs == nil {
		opt.Kwargs = make(map[string]string, 4)
	}

	// Last write wins, which matches common configuration override behavior.
	opt.Kwargs[key] = value

	return nil
}

func indexUnquotedEqual(s string) int {
	quote := rune(0)
	escaped := false

	for i, r := range s {
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
		case '=':
			return i
		}
	}

	return -1
}

func unquote(s string) (string, error) {
	s = strings.TrimSpace(s)

	if len(s) < 2 {
		return unescape(s), nil
	}

	first := s[0]
	last := s[len(s)-1]

	if (first == '\'' && last == '\'') || (first == '"' && last == '"') {
		return unescape(s[1 : len(s)-1]), nil
	}

	if first == '\'' || first == '"' || last == '\'' || last == '"' {
		return "", fmt.Errorf("mismatched quote in %q", s)
	}

	return unescape(s), nil
}

func unescape(s string) string {
	if !strings.ContainsRune(s, '\\') {
		return s
	}

	var b strings.Builder
	b.Grow(len(s))

	escaped := false

	for _, r := range s {
		if escaped {
			b.WriteRune(r)
			escaped = false
			continue
		}

		if r == '\\' {
			escaped = true
			continue
		}

		b.WriteRune(r)
	}

	if escaped {
		b.WriteRune('\\')
	}

	return b.String()
}

func appendIndex(parent []int, child int) []int {
	out := make([]int, 0, len(parent)+1)
	out = append(out, parent...)
	out = append(out, child)
	return out
}
