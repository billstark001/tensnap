package protocol

import (
	"encoding/json"
	"testing"
)

func TestNormalizeSimulatorInfoEncodesNilCapabilitiesAsArray(t *testing.T) {
	info := NormalizeSimulatorInfo(&SimulatorInfoPayload{Model: ModelInfo{ID: "model"}})
	encoded, err := json.Marshal(info)
	if err != nil {
		t.Fatalf("marshal simulator info: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("unmarshal simulator info: %v", err)
	}
	capabilities, ok := decoded["capabilities"].([]any)
	if !ok || len(capabilities) != 0 {
		t.Fatalf("capabilities must be an empty array, got %#v", decoded["capabilities"])
	}
}
