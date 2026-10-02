package protocol

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/vmihailenco/msgpack/v5"
)

type Codec interface {
	Encode(msg *Message) ([]byte, error)
	Decode(data []byte) (*Message, error)
	TextMode() bool
}

type JSONCodec struct{}

func (JSONCodec) Encode(msg *Message) ([]byte, error) { return json.Marshal(msg) }

type rawEnvelope struct {
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
	Timestamp *int64          `json:"timestamp,omitempty"`
}

func (JSONCodec) Decode(data []byte) (*Message, error) {
	var r rawEnvelope
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, fmt.Errorf("protocol: json decode: %w", err)
	}
	return &Message{Type: r.Type, Payload: r.Payload, Timestamp: r.Timestamp}, nil
}

func (JSONCodec) TextMode() bool { return true }

// MsgPackCodec uses the same JSON field names as the canonical wire schema.
// MessagePack binary values remain bytes inside payloads; the shared
// DecodePayload helper maps the resulting object into typed Go payloads.
type MsgPackCodec struct{}

const maxPooledMsgPackBuffer = 256 << 10

type msgPackEncoder struct {
	buffer  bytes.Buffer
	encoder *msgpack.Encoder
}

var msgPackEncoderPool = sync.Pool{New: func() any {
	state := &msgPackEncoder{}
	state.encoder = msgpack.NewEncoder(&state.buffer)
	state.encoder.SetCustomStructTag("json")
	return state
}}

type msgPackDecoder struct {
	reader  bytes.Reader
	decoder *msgpack.Decoder
}

var msgPackDecoderPool = sync.Pool{New: func() any {
	state := &msgPackDecoder{}
	state.decoder = msgpack.NewDecoder(&state.reader)
	state.decoder.SetCustomStructTag("json")
	return state
}}

func (MsgPackCodec) Encode(msg *Message) ([]byte, error) {
	state := msgPackEncoderPool.Get().(*msgPackEncoder)
	state.buffer.Reset()
	state.encoder.ResetWriter(&state.buffer)
	if err := state.encoder.Encode(msg); err != nil {
		msgPackEncoderPool.Put(state)
		return nil, fmt.Errorf("protocol: msgpack encode: %w", err)
	}
	// The WebSocket writer owns the returned bytes after this call, so the
	// pooled buffer cannot be returned directly.
	data := bytes.Clone(state.buffer.Bytes())
	if state.buffer.Cap() > maxPooledMsgPackBuffer {
		state.buffer = bytes.Buffer{}
	}
	msgPackEncoderPool.Put(state)
	return data, nil
}

func (MsgPackCodec) Decode(data []byte) (*Message, error) {
	state := msgPackDecoderPool.Get().(*msgPackDecoder)
	state.reader.Reset(data)
	state.decoder.ResetReader(&state.reader)
	var message Message
	err := state.decoder.Decode(&message)
	remaining := state.reader.Len()
	state.reader.Reset(nil)
	msgPackDecoderPool.Put(state)
	if err != nil {
		return nil, fmt.Errorf("protocol: msgpack decode: %w", err)
	}
	if remaining != 0 {
		return nil, fmt.Errorf("protocol: msgpack trailing data")
	}
	return &message, nil
}

func (MsgPackCodec) TextMode() bool { return false }

// DecodePayload unmarshals msg.Payload (json.RawMessage) into dst.
func DecodePayload(msg *Message, dst any) error {
	switch v := msg.Payload.(type) {
	case json.RawMessage:
		return json.Unmarshal(v, dst)
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return fmt.Errorf("protocol: re-marshal payload: %w", err)
		}
		return json.Unmarshal(b, dst)
	}
}
