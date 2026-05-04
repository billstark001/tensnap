package server

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
)

type hookModel struct {
	abm.Base
	assetPayload      *protocol.AssetSyncPayload
	screenshotPayload *protocol.ScreenshotResponsePayload
	assetErr          error
}

func (m *hookModel) OnAssetSync(_ abm.Emitter, payload *protocol.AssetSyncPayload) error {
	m.assetPayload = payload
	return m.assetErr
}

func (m *hookModel) OnScreenshotResponse(_ abm.Emitter, payload *protocol.ScreenshotResponsePayload) error {
	m.screenshotPayload = payload
	return nil
}

func TestDispatchAssetSyncUsesOptionalHook(t *testing.T) {
	model := &hookModel{}
	payload := protocol.AssetSyncPayload{Assets: map[string]string{"asset-1": "hash-1"}}
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	err = dispatch(&protocol.Message{Type: protocol.TypeAssetSync, Payload: json.RawMessage(encoded)}, model, abm.NewSink())
	if err != nil {
		t.Fatalf("dispatch asset_sync: %v", err)
	}
	if model.assetPayload == nil {
		t.Fatal("expected asset_sync payload to be delivered")
	}
	if got := model.assetPayload.Assets["asset-1"]; got != "hash-1" {
		t.Fatalf("unexpected asset hash: %q", got)
	}
}

func TestDispatchScreenshotResponseUsesOptionalHook(t *testing.T) {
	model := &hookModel{}
	errorMessage := "not-supported"
	payload := protocol.ScreenshotResponsePayload{RequestID: "req-1", Error: &errorMessage}
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	err = dispatch(&protocol.Message{Type: protocol.TypeScreenshotResponse, Payload: json.RawMessage(encoded)}, model, abm.NewSink())
	if err != nil {
		t.Fatalf("dispatch screenshot_response: %v", err)
	}
	if model.screenshotPayload == nil {
		t.Fatal("expected screenshot_response payload to be delivered")
	}
	if got := model.screenshotPayload.RequestID; got != "req-1" {
		t.Fatalf("unexpected request id: %q", got)
	}
	if model.screenshotPayload.Error == nil || *model.screenshotPayload.Error != errorMessage {
		t.Fatalf("unexpected screenshot error payload: %+v", model.screenshotPayload)
	}
}

func TestDispatchAssetSyncPropagatesHookError(t *testing.T) {
	wantErr := errors.New("asset sync failed")
	model := &hookModel{assetErr: wantErr}
	payload := protocol.AssetSyncPayload{Assets: map[string]string{"asset-1": "hash-1"}}
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}

	err = dispatch(&protocol.Message{Type: protocol.TypeAssetSync, Payload: json.RawMessage(encoded)}, model, abm.NewSink())
	if !errors.Is(err, wantErr) {
		t.Fatalf("expected %v, got %v", wantErr, err)
	}
}
