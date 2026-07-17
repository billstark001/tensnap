package binding

import (
	"encoding/base64"
	"encoding/json"
	"fmt"

	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

func encodeCheckpoint(data any) (protocol.Checkpoint, error) {
	encoding := "application/json"
	var raw []byte
	var err error
	switch value := data.(type) {
	case []byte:
		encoding = "application/octet-stream"
		raw = append([]byte(nil), value...)
	case string:
		raw, err = json.Marshal(value)
	default:
		raw, err = json.Marshal(data)
	}
	if err != nil {
		return protocol.Checkpoint{}, fmt.Errorf("tensnap: encode checkpoint: %w", err)
	}
	return protocol.Checkpoint{
		Encoding: encoding,
		Data:     base64.StdEncoding.EncodeToString(raw),
	}, nil
}

func decodeCheckpoint(checkpoint *protocol.Checkpoint) (any, error) {
	if checkpoint == nil {
		return nil, nil
	}
	encoded, ok := checkpoint.Data.(string)
	if !ok {
		return nil, fmt.Errorf("tensnap: checkpoint data must be base64 text")
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("tensnap: decode checkpoint: %w", err)
	}
	switch checkpoint.Encoding {
	case "application/octet-stream":
		return raw, nil
	case "application/json":
		var data any
		if err := json.Unmarshal(raw, &data); err != nil {
			return nil, fmt.Errorf("tensnap: decode checkpoint JSON: %w", err)
		}
		return data, nil
	default:
		return nil, fmt.Errorf("tensnap: unsupported checkpoint encoding %q", checkpoint.Encoding)
	}
}
