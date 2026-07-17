package binding

import (
	"bytes"
	"encoding/json"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"

	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

type mappingAgent struct {
	ID       string `tensnap:"id"`
	X        int    `tensnap:"x"`
	Y        int    `tensnap:"y"`
	Label    string `tensnap:"name=label"`
	Optional string `tensnap:"name=optional"`
	Ignored  int
}

type mappingEdge struct {
	Source  string `tensnap:"source"`
	Target  string `tensnap:"target"`
	Weight  int    `tensnap:"weight"`
	Ignored bool
}

func exactJSON(t *testing.T, value any, want map[string]any) {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal(encoded, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("exact mapping mismatch\n got: %#v\nwant: %#v", got, want)
	}
}

func parseSimulatorMessagesWithProtocolSchema(t *testing.T, messages []any) {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("Node.js is unavailable; native exact-output assertions still ran")
	}
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve mapping test path")
	}
	schemasURL := "file://" + filepath.ToSlash(filepath.Join(filepath.Dir(thisFile), "..", "..", "protocol", "dist", "schemas.js"))
	input, err := json.Marshal(messages)
	if err != nil {
		t.Fatalf("marshal protocol messages: %v", err)
	}
	script := `const { SimulatorToRendererMessageSchema } = await import(process.argv[1]); for (const message of JSON.parse(process.argv[2])) SimulatorToRendererMessageSchema.parse(message);`
	command := exec.Command("node", "--input-type=module", "-e", script, schemasURL, string(input))
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		t.Fatalf("v0.3 schema rejected binding output: %v\n%s", err, stderr.String())
	}
}

func TestV03ExactDeclarativeMappingAndOmissions(t *testing.T) {
	model := &taggedModel{Config: taggedConfig{Width: 10, Height: 20, Density: 0.5}}
	params := MustParamsFromTags(func(model *taggedModel) *taggedConfig { return &model.Config }, TagScope("param"))
	width := params[0].Metadata(model).Definition
	exactJSON(t, width, map[string]any{
		"id": "width", "type": "number", "label": "Width", "value": 10.0,
		"min": 1.0, "max": 100.0, "step": 1.0, "allow_runtime_change": false,
	})
	agent := ProjectTagsRequired[*taggedModel, mappingAgent]([]string{"id", "x", "y"})(model, mappingAgent{
		ID: "a", X: 2, Y: 3, Label: "Alpha",
	})
	exactJSON(t, agent, map[string]any{
		"id": "a", "x": 2.0, "y": 3.0, "label": "Alpha", "optional": "",
	})
	edgeItem := ProjectTagsRequired[*taggedModel, mappingEdge]([]string{"source", "target"}, TagScope("edge"))(model, mappingEdge{
		Source: "a", Target: "b",
	})
	exactJSON(t, edgeItem, map[string]any{
		"source": "a", "target": "b", "weight": 0.0,
	})

	edge := NewEdgeLayer[*testModel, testEdge]("edges").
		AgentLayer("agents").
		Data(func(*testModel) map[string]any { return map[string]any{"link_distance": 20} })
	layer := edge.CreatePayload(&testModel{}, "world")
	exactJSON(t, layer, map[string]any{
		"env_id": "world", "layer_id": "edges", "layer_type": "edge",
		"dependency_layer_ids": map[string]any{"agent": "agents"},
		"metadata":             map[string]any{"link_distance": 20.0},
	})

	router := NewBindingActionRouter(model, false)
	router.Set(NewAction("shuffle", "Shuffle", func(*taggedModel) error { return nil }))
	action := router.BuildState()[0]
	exactJSON(t, action, map[string]any{"id": "shuffle", "label": "Shuffle"})

	chart := NewChartGroup("counts", "Counts",
		NewChartSeries("alive", "Alive", "#16A34A", func(*taggedModel) any { return 2 }),
		NewChartSeries("dead", "Dead", "#9CA3AF", func(*taggedModel) any { return 1 }),
	).Metadata()
	exactJSON(t, chart, map[string]any{
		"id": "counts", "label": "Counts",
		"data_list": []any{
			map[string]any{"id": "alive", "label": "Alive", "color": "#16A34A"},
			map[string]any{"id": "dead", "label": "Dead", "color": "#9CA3AF"},
		},
	})

	language := "go"
	parseSimulatorMessagesWithProtocolSchema(t, []any{
		map[string]any{"type": "simulator_info", "payload": protocol.SimulatorInfoPayload{
			ProtocolVersion: "0.3", Binding: protocol.BindingInfo{Name: "tensnap-go", Version: "0.3.0", Language: &language},
			Model: protocol.ModelInfo{ID: "mapping.go"}, InstanceID: "instance-1", Capabilities: []string{},
		}},
		map[string]any{"type": "param_create", "payload": width},
		map[string]any{"type": "action_create", "payload": action},
		map[string]any{"type": "chart_create", "payload": chart},
		map[string]any{"type": "env_layer_create", "payload": layer},
		map[string]any{"type": "item_create", "payload": map[string]any{
			"env_id": "world", "layer_id": "agents", "items": []any{agent},
		}},
		map[string]any{"type": "item_create", "payload": map[string]any{
			"env_id": "world", "layer_id": "edges", "items": []any{edgeItem},
		}},
	})
}
