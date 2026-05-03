package protocol

import (
	"encoding/json"
	"fmt"
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
