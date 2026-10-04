package protocol

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strconv"
	"testing"

	"github.com/vmihailenco/msgpack/v5"
)

func TestJSONCodecUsesCanonicalWireKeysAndTypedPayloads(t *testing.T) {
	codec := JSONCodec{}
	original := NewMessage(TypeActionInvoke, &ActionInvokePayload{ID: "step", RequestID: "action-7"})
	encoded, err := codec.Encode(original)
	if err != nil {
		t.Fatal(err)
	}
	if !codec.TextMode() {
		t.Fatal("JSON must use text WebSocket frames")
	}
	var raw map[string]any
	if err := json.Unmarshal(encoded, &raw); err != nil {
		t.Fatal(err)
	}
	if raw["type"] != TypeActionInvoke || raw["timestamp"] != nil {
		t.Fatalf("wrong JSON envelope: %#v", raw)
	}
	payload, ok := raw["payload"].(map[string]any)
	if !ok || payload["request_id"] != "action-7" {
		t.Fatalf("JSON wire tags were not honored: %#v", raw["payload"])
	}
	decoded, err := codec.Decode(encoded)
	if err != nil {
		t.Fatal(err)
	}
	var action ActionInvokePayload
	if err := DecodePayload(decoded, &action); err != nil {
		t.Fatal(err)
	}
	if action.ID != "step" || action.RequestID != "action-7" {
		t.Fatalf("wrong typed JSON payload: %+v", action)
	}
	if _, err := codec.Decode(append(encoded, []byte("null")...)); err == nil {
		t.Fatal("accepted trailing JSON value")
	}
	if _, err := codec.Decode([]byte(`{"type":`)); err == nil {
		t.Fatal("accepted incomplete JSON")
	}
}

func TestJSONAndMsgPackDecodeEquivalentNestedPayloads(t *testing.T) {
	original := NewMessage(TypeParamChange, map[string]any{
		"id": "rates", "value": map[string]any{"beta": 0.125, "active": true, "sites": []any{0, 4096}},
	})
	jsonBytes, err := (JSONCodec{}).Encode(original)
	if err != nil {
		t.Fatal(err)
	}
	msgPackBytes, err := (MsgPackCodec{}).Encode(original)
	if err != nil {
		t.Fatal(err)
	}
	jsonMessage, err := (JSONCodec{}).Decode(jsonBytes)
	if err != nil {
		t.Fatal(err)
	}
	msgPackMessage, err := (MsgPackCodec{}).Decode(msgPackBytes)
	if err != nil {
		t.Fatal(err)
	}
	var fromJSON, fromMsgPack ParamChangePayload
	if err := DecodePayload(jsonMessage, &fromJSON); err != nil {
		t.Fatal(err)
	}
	if err := DecodePayload(msgPackMessage, &fromMsgPack); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(fromJSON, fromMsgPack) {
		t.Fatalf("encoding changed payload: JSON=%#v MessagePack=%#v", fromJSON, fromMsgPack)
	}
}

func TestMsgPackCodecUsesCanonicalWireKeysAndTypedPayloads(t *testing.T) {
	codec := MsgPackCodec{}
	requestID := "action-7"
	original := NewMessage(TypeActionInvoke, &ActionInvokePayload{ID: "step", RequestID: requestID})
	encoded, err := codec.Encode(original)
	if err != nil {
		t.Fatal(err)
	}
	if codec.TextMode() {
		t.Fatal("MessagePack must use binary WebSocket frames")
	}
	var raw map[string]any
	if err := msgpack.Unmarshal(encoded, &raw); err != nil {
		t.Fatal(err)
	}
	if raw["type"] != TypeActionInvoke {
		t.Fatalf("wrong wire envelope: %#v", raw)
	}
	payload, ok := raw["payload"].(map[string]any)
	if !ok || payload["request_id"] != requestID {
		t.Fatalf("JSON wire tags were not honored: %#v", raw["payload"])
	}
	decoded, err := codec.Decode(encoded)
	if err != nil {
		t.Fatal(err)
	}
	var action ActionInvokePayload
	if err := DecodePayload(decoded, &action); err != nil {
		t.Fatal(err)
	}
	if action.ID != "step" || action.RequestID != requestID {
		t.Fatalf("wrong typed payload: %+v", action)
	}
}

func TestMsgPackCodecPreservesNestedValuesAndRejectsExtraFrames(t *testing.T) {
	codec := MsgPackCodec{}
	original := NewMessage(TypeParamChange, map[string]any{
		"id": "rates", "value": map[string]any{"beta": 0.125, "active": true, "sites": []any{0, 4096}},
	})
	encoded, err := codec.Encode(original)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := codec.Decode(encoded)
	if err != nil {
		t.Fatal(err)
	}
	var parameter ParamChangePayload
	if err := DecodePayload(decoded, &parameter); err != nil {
		t.Fatal(err)
	}
	value, ok := parameter.Value.(map[string]any)
	if !ok || value["beta"] != 0.125 || value["active"] != true || !reflect.DeepEqual(value["sites"], []any{float64(0), float64(4096)}) {
		t.Fatalf("nested parameter changed: %#v", parameter.Value)
	}
	if _, err := codec.Decode(append(encoded, 0xc0)); err == nil {
		t.Fatal("accepted trailing MessagePack value")
	}
	if _, err := codec.Decode([]byte{0xc1}); err == nil {
		t.Fatal("accepted invalid MessagePack")
	}
}

func BenchmarkCodecs(b *testing.B) {
	for _, size := range []int{1, 1024} {
		items := make([]map[string]any, size)
		for index := range items {
			items[index] = map[string]any{"id": index, "x": index % 64, "y": index / 64, "state": "susceptible"}
		}
		message := NewMessage(TypeItemCreate, map[string]any{"env_id": "study", "layer_id": "agents", "items": items})
		for name, codec := range map[string]Codec{"json": JSONCodec{}, "msgpack": MsgPackCodec{}} {
			b.Run(name+"/items="+strconv.Itoa(size)+"/encode", func(b *testing.B) {
				b.ReportAllocs()
				for i := 0; i < b.N; i++ {
					if _, err := codec.Encode(message); err != nil {
						b.Fatal(err)
					}
				}
			})
			data, err := codec.Encode(message)
			if err != nil {
				b.Fatal(err)
			}
			b.Run(name+"/items="+strconv.Itoa(size)+"/decode", func(b *testing.B) {
				b.ReportAllocs()
				for i := 0; i < b.N; i++ {
					if _, err := codec.Decode(data); err != nil {
						b.Fatal(err)
					}
				}
			})
		}
	}
}

func TestMsgPackCodecDoesNotAliasReusedBuffer(t *testing.T) {
	codec := MsgPackCodec{}
	first, err := codec.Encode(NewMessage(TypeParamChange, map[string]any{"id": "a", "value": 1}))
	if err != nil {
		t.Fatal(err)
	}
	want := bytes.Clone(first)
	for i := 0; i < 20; i++ {
		if _, err := codec.Encode(NewMessage(TypeParamChange, map[string]any{"id": "b", "value": i})); err != nil {
			t.Fatal(err)
		}
	}
	if !bytes.Equal(first, want) {
		t.Fatal("pooled encoder mutated a previous frame")
	}
}
