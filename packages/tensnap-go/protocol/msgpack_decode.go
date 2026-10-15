package protocol

import (
	"encoding/binary"
	"io"

	"github.com/vmihailenco/msgpack/v5"
	"github.com/vmihailenco/msgpack/v5/msgpcode"
)

// bytes.Reader satisfies the library's byte-reader interface, so decoding never
// buffers ahead. Inspecting the next code here avoids consuming it twice.
func (s *msgPackDecoder) nextCode() (byte, error) {
	if s.Reader.Len() == 0 {
		return 0, io.ErrUnexpectedEOF
	}
	remaining := s.Reader.Len()
	code := s.data[len(s.data)-remaining]
	return code, nil
}

func (s *msgPackDecoder) checkWideLength(code byte) error {
	remaining := s.Reader.Len()
	// These 32-bit lengths can request gigabytes from a tiny frame. Smaller
	// headers are inherently bounded; leave their parsing to the library.
	if code == msgpcode.Bin32 || code == msgpcode.Str32 || code == msgpcode.Ext32 {
		headerSize := 5
		if code == msgpcode.Ext32 {
			headerSize++ // Extension headers also contain a type byte.
		}
		if remaining < headerSize || uint64(binary.BigEndian.Uint32(s.data[len(s.data)-remaining+1:])) > uint64(remaining-headerSize) {
			return io.ErrUnexpectedEOF
		}
	}
	return nil
}

// Decode containers once, checking their advertised size against the remaining
// frame before allocation. Every array item needs at least one byte; every map
// entry needs at least two. Scalar and extension decoding stays in the library.
func (s *msgPackDecoder) decodeValue() (any, error) {
	code, err := s.nextCode()
	if err != nil {
		return nil, err
	}
	// Single-byte integers and short strings cannot advertise large allocations.
	if msgpcode.IsFixedNum(code) || msgpcode.IsFixedString(code) {
		return s.decoder.DecodeInterface()
	}
	if msgpcode.IsFixedArray(code) || code == msgpcode.Array16 || code == msgpcode.Array32 {
		n, err := s.decoder.DecodeArrayLen()
		if err != nil {
			return nil, err
		}
		if n < 0 || n > s.Reader.Len() {
			return nil, io.ErrUnexpectedEOF
		}
		values := make([]any, n)
		for i := range values {
			values[i], err = s.decodeValue()
			if err != nil {
				return nil, err
			}
		}
		return values, nil
	}
	if msgpcode.IsFixedMap(code) || code == msgpcode.Map16 || code == msgpcode.Map32 {
		n, err := s.decoder.DecodeMapLen()
		if err != nil {
			return nil, err
		}
		if n < 0 || n > s.Reader.Len()/2 {
			return nil, io.ErrUnexpectedEOF
		}
		values := make(map[string]any, n)
		for i := 0; i < n; i++ {
			key, err := s.decodeString()
			if err != nil {
				return nil, err
			}
			value, err := s.decodeValue()
			if err != nil {
				return nil, err
			}
			values[key] = value
		}
		return values, nil
	}
	if code == msgpcode.Bin32 || code == msgpcode.Str32 || code == msgpcode.Ext32 {
		if err := s.checkWideLength(code); err != nil {
			return nil, err
		}
	}
	return s.decoder.DecodeInterface()
}

func (s *msgPackDecoder) decodeString() (string, error) {
	code, err := s.nextCode()
	if err != nil {
		return "", err
	}
	if code == msgpcode.Str32 || code == msgpcode.Bin32 {
		if err := s.checkWideLength(code); err != nil {
			return "", err
		}
	}
	return s.decoder.DecodeString()
}

// Keep envelope decoding in the library, including positional structs, unknown
// fields, and nils. Only the untyped payload needs bounded
// container allocation.
type msgPackEnvelope struct {
	Type      string         `json:"type"`
	Payload   msgPackPayload `json:"payload"`
	Timestamp *int64         `json:"timestamp,omitempty"`
}

type msgPackPayload struct{ value any }

func (p *msgPackPayload) DecodeMsgpack(decoder *msgpack.Decoder) (err error) {
	state := decoder.Buffered().(*msgPackDecoder)
	p.value, err = state.decodeValue()
	return err
}
