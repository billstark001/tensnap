package binding

import (
	"testing"

	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

type taggedConfig struct {
	Width   int     `tensnap:"id=width,scope=param,label=Width,min=1,max=100,step=1,runtime=false; width,scope=space"`
	Height  int     `tensnap:"id=height,scope=param,label=Height,min=1,max=100,step=1,runtime=false; height,scope=space"`
	Density float64 `tensnap:"id=density,label=Density,min=0,max=1,step=0.05"`
	Ignored string
}

type taggedModel struct {
	Config taggedConfig
}

type taggedAgent struct {
	ID string `tensnap:"id"`
	X  int    `tensnap:"x"`
	Y  int    `tensnap:"y"`
	Z  int
}

func TestParamsFromTagsUsesScopeAndPointerRoot(t *testing.T) {
	model := &taggedModel{Config: taggedConfig{Width: 10, Height: 20, Density: 0.5}}
	params := MustParamsFromTags(
		func(model *taggedModel) *taggedConfig { return &model.Config },
		TagScope("param"),
	)
	if len(params) != 3 {
		t.Fatalf("params len = %d, want 3", len(params))
	}

	metadata := params[0].Metadata(model)
	number, ok := metadata.Definition.(protocol.NumberParameter)
	if !ok {
		t.Fatalf("definition = %T, want NumberParameter", metadata.Definition)
	}
	if number.ID != "width" || number.Label != "Width" || number.Min != 1 || number.Max != 100 {
		t.Fatalf("unexpected number metadata: %#v", number)
	}
	if err := metadata.OnSet(42.0); err != nil {
		t.Fatalf("OnSet returned error: %v", err)
	}
	if model.Config.Width != 42 {
		t.Fatalf("width = %d, want 42", model.Config.Width)
	}
}

func TestProjectTagsUsesDefaultScopeAndIgnoresUntaggedFields(t *testing.T) {
	project := ProjectTagsRequired[*taggedModel, taggedAgent]([]string{"id", "x", "y"})
	snapshot := project(&taggedModel{}, taggedAgent{ID: "a", X: 1, Y: 2, Z: 3})
	if len(snapshot) != 3 {
		t.Fatalf("snapshot len = %d, want 3: %#v", len(snapshot), snapshot)
	}
	if snapshot["id"] != "a" || snapshot["x"] != 1 || snapshot["y"] != 2 {
		t.Fatalf("unexpected snapshot: %#v", snapshot)
	}
	if _, ok := snapshot["z"]; ok {
		t.Fatalf("untagged field z should not be projected: %#v", snapshot)
	}
}

func TestMetadataFromTagsUsesExplicitScopeOnly(t *testing.T) {
	model := &taggedModel{Config: taggedConfig{Width: 10, Height: 20, Density: 0.5}}
	metadata := MustMetadataFromTags(
		func(model *taggedModel) *taggedConfig { return &model.Config },
		TagScope("space"),
	)
	got := metadata(model)
	if len(got) != 2 {
		t.Fatalf("metadata len = %d, want 2: %#v", len(got), got)
	}
	if got["width"] != 10 || got["height"] != 20 {
		t.Fatalf("unexpected metadata: %#v", got)
	}
	if _, ok := got["density"]; ok {
		t.Fatalf("unscoped param tag should not leak into space metadata: %#v", got)
	}
}
