package binding

import (
	"reflect"
	"testing"

	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

func TestDecodeCheckpointWireRepresentations(t *testing.T) {
	want := map[string]any{"steps": float64(3)}
	for name, data := range map[string]any{
		"base64":   "eyJzdGVwcyI6M30=",
		"data-url": "data:application/json;base64,eyJzdGVwcyI6M30=",
		"bytes":    []byte(`{"steps":3}`),
	} {
		t.Run(name, func(t *testing.T) {
			got, err := decodeCheckpoint(&protocol.Checkpoint{Encoding: "application/json", Data: data})
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("checkpoint = %#v, want %#v", got, want)
			}
		})
	}
}
