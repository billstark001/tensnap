package protocol

import "testing"

// Fuzz both malformed input and recovery of the pooled decoder afterwards.
// No invalid frame may poison a subsequent valid connection frame.
func FuzzMsgPackCodecDecodeRecovery(f *testing.F) {
	codec := MsgPackCodec{}
	valid, err := codec.Encode(NewMessage(TypeActionInvoke, &ActionInvokePayload{ID: "step", RequestID: "valid"}))
	if err != nil {
		f.Fatal(err)
	}
	f.Add(valid)
	f.Add([]byte{0xc1})
	f.Add([]byte{0xc0})
	f.Add([]byte{})
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > 4096 {
			t.Skip()
		}
		_, _ = codec.Decode(data)
		message, err := codec.Decode(valid)
		if err != nil {
			t.Fatalf("decoder did not recover: %v", err)
		}
		var action ActionInvokePayload
		if err := DecodePayload(message, &action); err != nil || action.ID != "step" || action.RequestID != "valid" {
			t.Fatalf("valid frame changed after malformed input: action=%+v err=%v", action, err)
		}
	})
}
