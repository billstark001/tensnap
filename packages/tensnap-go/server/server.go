// Package server wires an abm.Model into a TenSnap v0.2 WebSocket simulator.
//
// Minimal usage — 4 lines:
//
//	server.Run(ctx, server.Options{Addr: ":8765"}, &MyModel{})
//
// For per-session isolation (own model instance per renderer):
//
//	server.RunFactory(ctx, opts, func() abm.Model { return NewMyModel() })
package server

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
	"github.com/gorilla/websocket"
)

// #region Public API

// Options configures the WebSocket server.
type Options struct {
	Addr            string         // e.g. ":8765"
	Path            string         // WebSocket path, default "/ws"
	Codec           protocol.Codec // default JSONCodec
	Upgrader        *websocket.Upgrader
	WriteTimeout    time.Duration // default 10s
	ReadTimeout     time.Duration // default: none
	MaxMessageBytes int64         // default 4 MiB
}

func (o *Options) applyDefaults() {
	if o.Path == "" {
		o.Path = "/"
	}
	if o.Codec == nil {
		o.Codec = protocol.JSONCodec{}
	}
	if o.WriteTimeout == 0 {
		o.WriteTimeout = 10 * time.Second
	}
	if o.MaxMessageBytes == 0 {
		o.MaxMessageBytes = 4 << 20
	}
	if o.Upgrader == nil {
		o.Upgrader = &websocket.Upgrader{
			CheckOrigin: func(_ *http.Request) bool { return true },
		}
	}
}

// Run starts the server with a single shared model instance.
// Suitable when the model is already goroutine-safe or single-renderer.
func Run(ctx context.Context, opts Options, model abm.Model) error {
	return RunFactory(ctx, opts, func() abm.Model { return model })
}

// RunFactory starts the server; factory() is called for each new connection,
// giving every renderer session its own isolated model instance.
func RunFactory(ctx context.Context, opts Options, factory func() abm.Model) error {
	opts.applyDefaults()
	mux := http.NewServeMux()
	mux.HandleFunc(opts.Path, makeHandler(opts, factory))
	srv := &http.Server{Addr: opts.Addr, Handler: mux}

	errCh := make(chan error, 1)
	go func() { errCh <- srv.ListenAndServe() }()

	select {
	case <-ctx.Done():
		shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return srv.Shutdown(shutCtx)
	case err := <-errCh:
		return err
	}
}

// #endregion

// #region Internal

func makeHandler(opts Options, factory func() abm.Model) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := opts.Upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		conn.SetReadLimit(opts.MaxMessageBytes)

		model := factory()
		em := newSessionEmitter(conn, opts.Codec, opts.WriteTimeout)
		readLoop(conn, opts, model, em)
		conn.Close()
	}
}

func readLoop(conn *websocket.Conn, opts Options, model abm.Model, em *SessionEmitter) {
	for {
		if opts.ReadTimeout > 0 {
			_ = conn.SetReadDeadline(time.Now().Add(opts.ReadTimeout))
		}
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		msg, err := opts.Codec.Decode(data)
		if err != nil {
			_ = em.Error(fmt.Sprintf("decode: %v", err))
			continue
		}
		if err := dispatch(msg, model, em); err != nil {
			_ = em.Error(fmt.Sprintf("handler[%s]: %v", msg.Type, err))
		}
	}
}

func dispatch(msg *protocol.Message, model abm.Model, em abm.Emitter) error {
	switch msg.Type {
	case protocol.TypeStateSync:
		var p protocol.StateSyncPayload
		if err := protocol.DecodePayload(msg, &p); err != nil {
			return err
		}
		return model.OnStateSync(em, &p)

	case protocol.TypeParamChange:
		var p protocol.ParamChangePayload
		if err := protocol.DecodePayload(msg, &p); err != nil {
			return err
		}
		return model.OnParamChange(em, p.ID, p.Value)

	case protocol.TypeActionStart:
		var p protocol.ActionStartPayload
		if err := protocol.DecodePayload(msg, &p); err != nil {
			return err
		}
		cont := p.Continuous != nil && *p.Continuous
		return model.OnAction(em, p.ID, p.TickID, cont)

	case protocol.TypeAssetSync:
		var p protocol.AssetSyncPayload
		if err := protocol.DecodePayload(msg, &p); err != nil {
			return err
		}
		handler, ok := model.(abm.AssetSyncHandler)
		if !ok {
			return nil
		}
		return handler.OnAssetSync(em, &p)

	case protocol.TypeScreenshotResponse:
		var p protocol.ScreenshotResponsePayload
		if err := protocol.DecodePayload(msg, &p); err != nil {
			return err
		}
		handler, ok := model.(abm.ScreenshotResponseHandler)
		if !ok {
			return nil
		}
		return handler.OnScreenshotResponse(em, &p)

	case protocol.TypeError:
		var p protocol.ErrorPayload
		if err := protocol.DecodePayload(msg, &p); err != nil {
			return err
		}
		lv := protocol.LogLevelError
		return em.Log(&protocol.LogPayload{Message: "renderer error: " + p.Error, Level: &lv})

	default:
		return nil // unknown types silently ignored per spec
	}
}

// #endregion

// #region SessionEmitter — live Emitter backed by a WebSocket connection

type SessionEmitter struct {
	conn    *websocket.Conn
	codec   protocol.Codec
	timeout time.Duration
	mu      sync.Mutex
}

func newSessionEmitter(conn *websocket.Conn, codec protocol.Codec, timeout time.Duration) *SessionEmitter {
	return &SessionEmitter{conn: conn, codec: codec, timeout: timeout}
}

func (e *SessionEmitter) send(msgType string, payload any) error {
	data, err := e.codec.Encode(protocol.NewMessage(msgType, payload))
	if err != nil {
		return err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.timeout > 0 {
		_ = e.conn.SetWriteDeadline(time.Now().Add(e.timeout))
	}
	if e.codec.TextMode() {
		return e.conn.WriteMessage(websocket.TextMessage, data)
	}
	return e.conn.WriteMessage(websocket.BinaryMessage, data)
}

func (e *SessionEmitter) MetadataUpdate(p *protocol.MetadataUpdatePayload) error {
	return e.send(protocol.TypeMetadataUpdate, p)
}
func (e *SessionEmitter) StateSyncBegin(requestID *string) error {
	return e.send(protocol.TypeStateSyncBegin, &protocol.StateSyncBracketPayload{RequestID: requestID})
}
func (e *SessionEmitter) StateSyncEnd(requestID *string) error {
	return e.send(protocol.TypeStateSyncEnd, &protocol.StateSyncBracketPayload{RequestID: requestID})
}
func (e *SessionEmitter) ActionEnd(p *protocol.ActionEndPayload) error {
	return e.send(protocol.TypeActionEnd, p)
}
func (e *SessionEmitter) EnvCreate(id, envType string) error {
	return e.send(protocol.TypeEnvCreate, &protocol.EnvCreatePayload{ID: id, Type: envType})
}
func (e *SessionEmitter) EnvDelete(id string) error {
	return e.send(protocol.TypeEnvDelete, &protocol.EnvDeletePayload{ID: id})
}
func (e *SessionEmitter) EnvLayerCreate(p *protocol.EnvLayerCreatePayload) error {
	return e.send(protocol.TypeEnvLayerCreate, p)
}
func (e *SessionEmitter) EnvLayerUpdate(p *protocol.EnvLayerUpdatePayload) error {
	return e.send(protocol.TypeEnvLayerUpdate, p)
}
func (e *SessionEmitter) EnvLayerDelete(envID, layerID string) error {
	return e.send(protocol.TypeEnvLayerDelete, &protocol.EnvLayerDeletePayload{EnvID: envID, LayerID: layerID})
}
func (e *SessionEmitter) ItemCreate(envID, layerID string, items []map[string]any) error {
	return e.send(protocol.TypeItemCreate, &protocol.ItemCreatePayload{EnvID: envID, LayerID: layerID, Items: items})
}
func (e *SessionEmitter) ItemUpdate(envID, layerID string, items []map[string]any) error {
	return e.send(protocol.TypeItemUpdate, &protocol.ItemUpdatePayload{EnvID: envID, LayerID: layerID, Items: items})
}
func (e *SessionEmitter) ItemDelete(envID, layerID string, items []any) error {
	return e.send(protocol.TypeItemDelete, &protocol.ItemDeletePayload{EnvID: envID, LayerID: layerID, Items: items})
}
func (e *SessionEmitter) ParamCreate(p any) error { return e.send(protocol.TypeParamCreate, p) }
func (e *SessionEmitter) ParamUpdate(p any) error { return e.send(protocol.TypeParamUpdate, p) }
func (e *SessionEmitter) ParamDelete(id string) error {
	return e.send(protocol.TypeParamDelete, &protocol.ParamDeletePayload{ID: id})
}
func (e *SessionEmitter) ParamSync(id string, value any) error {
	return e.send(protocol.TypeParamSync, &protocol.ParamSyncPayload{ID: id, Value: value})
}
func (e *SessionEmitter) ActionCreate(a *protocol.Action) error {
	return e.send(protocol.TypeActionCreate, a)
}
func (e *SessionEmitter) ActionUpdate(a *protocol.Action) error {
	return e.send(protocol.TypeActionUpdate, a)
}
func (e *SessionEmitter) ActionDelete(id string) error {
	return e.send(protocol.TypeActionDelete, &protocol.ActionDeletePayload{ID: id})
}
func (e *SessionEmitter) ChartCreate(meta *protocol.ChartGroupMetadata) error {
	return e.send(protocol.TypeChartCreate, meta)
}
func (e *SessionEmitter) ChartUpdate(p *protocol.ChartUpdatePayload) error {
	return e.send(protocol.TypeChartUpdate, p)
}
func (e *SessionEmitter) ChartDelete(id string) error {
	return e.send(protocol.TypeChartDelete, &protocol.ChartDeletePayload{ID: id})
}
func (e *SessionEmitter) AssetMeta(assets []protocol.AssetDescriptor) error {
	return e.send(protocol.TypeAssetMeta, &protocol.AssetMetaPayload{Assets: assets})
}
func (e *SessionEmitter) AssetData(p *protocol.AssetDataPayload) error {
	return e.send(protocol.TypeAssetData, p)
}
func (e *SessionEmitter) AssetDelete(ids []string) error {
	return e.send(protocol.TypeAssetDelete, &protocol.AssetDeletePayload{IDs: ids})
}
func (e *SessionEmitter) ScreenshotRequest(p *protocol.ScreenshotRequestPayload) error {
	return e.send(protocol.TypeScreenshotReq, p)
}
func (e *SessionEmitter) Log(p *protocol.LogPayload) error {
	return e.send(protocol.TypeLog, p)
}
func (e *SessionEmitter) Error(msg string) error {
	return e.send(protocol.TypeError, &protocol.ErrorPayload{Error: msg})
}

// #endregion
