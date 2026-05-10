package binding

import (
	"reflect"
	"testing"
)

func TestParseTagArgsAndKwargs(t *testing.T) {
	opt, err := ParseTag("required,min=3,max=20")
	if err != nil {
		t.Fatal(err)
	}

	if !reflect.DeepEqual(opt.Args, []string{"required"}) {
		t.Fatalf("unexpected args: %#v", opt.Args)
	}

	if got := opt.Key("min"); got != "3" {
		t.Fatalf("min = %q, want %q", got, "3")
	}

	if got := opt.Key("max"); got != "20" {
		t.Fatalf("max = %q, want %q", got, "20")
	}
}

func TestParseTagValueOnly(t *testing.T) {
	opt, err := ParseTag("required,trim,email")
	if err != nil {
		t.Fatal(err)
	}

	want := []string{"required", "trim", "email"}

	if !reflect.DeepEqual(opt.Args, want) {
		t.Fatalf("args = %#v, want %#v", opt.Args, want)
	}
}

func TestParseTagQuotedComma(t *testing.T) {
	opt, err := ParseTag(`required,pattern="a,b",message='hello,world'`)
	if err != nil {
		t.Fatal(err)
	}

	if got := opt.Key("pattern"); got != "a,b" {
		t.Fatalf("pattern = %q, want %q", got, "a,b")
	}

	if got := opt.Key("message"); got != "hello,world" {
		t.Fatalf("message = %q, want %q", got, "hello,world")
	}
}

func TestParseTagEscapedCharacters(t *testing.T) {
	opt, err := ParseTag(`name="hello \"go\"",path=a\,b`)
	if err != nil {
		t.Fatal(err)
	}

	if got := opt.Key("name"); got != `hello "go"` {
		t.Fatalf("name = %q", got)
	}

	if got := opt.Key("path"); got != "a,b" {
		t.Fatalf("path = %q", got)
	}
}

func TestParseTagDuplicateKeyLastWriteWins(t *testing.T) {
	opt, err := ParseTag("min=1,min=2")
	if err != nil {
		t.Fatal(err)
	}

	if got := opt.Key("min"); got != "2" {
		t.Fatalf("min = %q, want %q", got, "2")
	}
}

func TestParseTagLookup(t *testing.T) {
	opt, err := ParseTag("required,empty=")
	if err != nil {
		t.Fatal(err)
	}

	v, ok := opt.KeyLookup("empty")
	if !ok {
		t.Fatal("expected empty key to exist")
	}

	if v != "" {
		t.Fatalf("empty = %q, want empty string", v)
	}

	if _, ok := opt.KeyLookup("missing"); ok {
		t.Fatal("missing key should not exist")
	}
}

func TestParseStruct(t *testing.T) {
	type User struct {
		Name string `rule:"required,min=3"`
		Age  int    `rule:"min=18"`
		Note string
	}

	parsed, err := Parse(User{}, "rule")
	if err != nil {
		t.Fatal(err)
	}

	if parsed.Type.Name() != "User" {
		t.Fatalf("type = %s, want User", parsed.Type.Name())
	}

	if len(parsed.Fields) != 2 {
		t.Fatalf("fields len = %d, want 2", len(parsed.Fields))
	}

	name, ok := parsed.LookupField("Name")
	if !ok {
		t.Fatal("Name field not found")
	}

	if !name.HasArg("required") {
		t.Fatal("Name should have required arg")
	}

	if got := name.Key("min"); got != "3" {
		t.Fatalf("Name min = %q, want %q", got, "3")
	}

	age, ok := parsed.LookupField("Age")
	if !ok {
		t.Fatal("Age field not found")
	}

	if got := age.Key("min"); got != "18" {
		t.Fatalf("Age min = %q, want %q", got, "18")
	}

	if _, ok := parsed.LookupField("Note"); ok {
		t.Fatal("Note should not be parsed because it has no rule tag")
	}
}

func TestParseStructPointer(t *testing.T) {
	type User struct {
		Name string `rule:"required"`
	}

	parsed, err := Parse(&User{}, "rule")
	if err != nil {
		t.Fatal(err)
	}

	if len(parsed.Fields) != 1 {
		t.Fatalf("fields len = %d, want 1", len(parsed.Fields))
	}
}

func TestParseEmbeddedStruct(t *testing.T) {
	type Base struct {
		ID int `rule:"required"`
	}

	type User struct {
		Base
		Name string `rule:"required"`
	}

	parsed, err := Parse(User{}, "rule")
	if err != nil {
		t.Fatal(err)
	}

	if _, ok := parsed.LookupField("ID"); !ok {
		t.Fatal("embedded field ID not found")
	}

	if _, ok := parsed.LookupField("Name"); !ok {
		t.Fatal("field Name not found")
	}
}

func TestParseTagUnclosedQuote(t *testing.T) {
	_, err := ParseTag(`required,message="hello`)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestParseTagEmptyKeywordKey(t *testing.T) {
	_, err := ParseTag(`required,=bad`)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestParseRejectsNonStruct(t *testing.T) {
	_, err := Parse(123, "rule")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestParseRejectsEmptyTagKey(t *testing.T) {
	type User struct {
		Name string `rule:"required"`
	}

	_, err := Parse(User{}, "")
	if err == nil {
		t.Fatal("expected error")
	}
}
