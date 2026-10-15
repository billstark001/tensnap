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

func TestMsgPackCodecRejectsTruncatedCollectionClaims(t *testing.T) {
	codec := MsgPackCodec{}
	for _, payload := range [][]byte{
		{0xdf, 0xff, 0xff, 0xff, 0xff}, // map32 with no entries
		{0xdd, 0xff, 0xff, 0xff, 0xff}, // array32 with no elements
		{0x93, 0xa7, '0', '0', '0', 0xaf, 0xbc, '0', '0', 0x97, 0xdf, 0xdf, 0xdf, 0xdf, 0xdf, 0xdf, 0xdf, '0', '0', '0', 0xab},
	} {
		if _, err := codec.Decode(payload); err == nil {
			t.Fatalf("accepted truncated frame: %x", payload)
		}
		valid, _ := codec.Encode(NewMessage(TypeActionInvoke, &ActionInvokePayload{ID: "step", RequestID: "next"}))
		if _, err := codec.Decode(valid); err != nil {
			t.Fatal(err)
		}
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

func TestMsgPackCodecRejectsTruncatedPayloadLengths(t *testing.T) {
	prefix := []byte{0x81, 0xa7, 'p', 'a', 'y', 'l', 'o', 'a', 'd'}
	for _, code := range []byte{0xc6, 0xdb, 0xc9, 0xdd, 0xdf} {
		for _, length := range [][]byte{{}, {0, 0}, {0xff, 0xff, 0xff, 0xff}} {
			frame := append(bytes.Clone(prefix), code)
			frame = append(frame, length...)
			if _, err := (MsgPackCodec{}).Decode(frame); err == nil {
				t.Fatalf("accepted truncated payload: %x", frame)
			}
		}
	}
}

func TestMsgPackCodecMatchesLibraryValueSemantics(t *testing.T) {
	payloads := []any{
		nil, true, false, "", "hello", []byte{0xdd, 0xdf, 0xff, 0x00},
		int8(-12), uint64(1 << 63), float32(0.125), float64(-0.25),
		[]any{}, map[string]any{},
		bytes.Repeat([]byte{0xdd, 0xdf}, 32768), string(bytes.Repeat([]byte{'x'}, 65536)),
		map[string]any{"nested": []any{nil, true, map[string]any{"bytes": []byte{1, 2}}}},
	}
	for _, count := range []int{15, 16, 65535, 65536} {
		payloads = append(payloads, make([]any, count))
	}
	for index, payload := range payloads {
		t.Run(strconv.Itoa(index), func(t *testing.T) {
			data, err := (MsgPackCodec{}).Encode(NewMessage(TypeActionInvoke, payload))
			if err != nil {
				t.Fatal(err)
			}
			var expected Message
			decoder := msgpack.NewDecoder(bytes.NewReader(data))
			decoder.SetCustomStructTag("json")
			if err := decoder.Decode(&expected); err != nil {
				t.Fatal(err)
			}
			actual, err := (MsgPackCodec{}).Decode(data)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(expected, *actual) {
				t.Fatalf("value semantics changed: expected %#v, actual %#v", expected, *actual)
			}
		})
	}
}

func TestMsgPackCodecEnvelopeCompatibility(t *testing.T) {
	frames := []any{
		nil, []any{}, []any{"step", map[string]any{"id": "a"}, int64(123)},
		map[string]any{}, map[string]any{"type": nil, "payload": nil, "timestamp": nil},
		map[string]any{"type": "step", "payload": []any{}, "timestamp": int64(123), "unknown": map[string]any{"skip": []any{1, 2}}},
	}
	for index, frame := range frames {
		t.Run(strconv.Itoa(index), func(t *testing.T) {
			data, err := msgpack.Marshal(frame)
			if err != nil {
				t.Fatal(err)
			}
			var expected Message
			decoder := msgpack.NewDecoder(bytes.NewReader(data))
			decoder.SetCustomStructTag("json")
			if err := decoder.Decode(&expected); err != nil {
				t.Fatal(err)
			}
			actual, err := (MsgPackCodec{}).Decode(data)
			if err != nil || !reflect.DeepEqual(expected, *actual) {
				t.Fatalf("envelope changed: expected %#v, actual %#v, error %v", expected, actual, err)
			}
		})
	}
}
