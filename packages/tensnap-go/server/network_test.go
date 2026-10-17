package server

import (
	"context"
	"errors"
	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
	"github.com/gorilla/websocket"
	"net"
	"syscall"
	"testing"
	"time"
)

func closeListeners(listeners []net.Listener) {
	for _, listener := range listeners {
		listener.Close()
	}
}
func ipv6Unsupported(err error) bool {
	return errors.Is(err, syscall.EAFNOSUPPORT) || errors.Is(err, syscall.EPROTONOSUPPORT) || errors.Is(err, syscall.EADDRNOTAVAIL)
}

func TestIPFamilyListeners(t *testing.T) {
	for _, family := range []IPFamily{IPAuto, IPv4, IPv6} {
		t.Run(string(family), func(t *testing.T) {
			listeners, err := listenIP("localhost:0", family)
			if err != nil {
				if family == IPv6 && ipv6Unsupported(err) {
					t.Skip(err)
				}
				t.Fatal(err)
			}
			defer closeListeners(listeners)
			port := listeners[0].Addr().(*net.TCPAddr).Port
			if family != IPAuto && len(listeners) != 1 {
				t.Fatal("forced family opened multiple listeners")
			}
			for _, listener := range listeners {
				address := listener.Addr().(*net.TCPAddr)
				if address.Port != port {
					t.Fatal("port=0 selected different ports")
				}
				if family == IPv4 && address.IP.To4() == nil {
					t.Fatal("expected IPv4")
				}
				if family == IPv6 && address.IP.To4() != nil {
					t.Fatal("expected IPv6")
				}
				connection, err := net.Dial("tcp", address.String())
				if err != nil {
					t.Fatal(err)
				}
				connection.Close()
			}
		})
	}
}
func TestIPFamilyConflictRollsBack(t *testing.T) {
	blocker, err := listenIP("localhost:0", IPv6)
	if err != nil {
		if ipv6Unsupported(err) {
			t.Skip(err)
		}
		t.Fatal(err)
	}
	defer closeListeners(blocker)
	address := net.JoinHostPort("localhost", portString(blocker[0].Addr()))
	if listeners, err := listenIP(address, IPAuto); !errors.Is(err, syscall.EADDRINUSE) {
		closeListeners(listeners)
		t.Fatalf("expected EADDRINUSE, got %v", err)
	}
	replacement, err := listenIP(address, IPv4)
	if err != nil {
		t.Fatalf("IPv4 listener leaked: %v", err)
	}
	closeListeners(replacement)
}
func portString(address net.Addr) string {
	_, port, _ := net.SplitHostPort(address.String())
	return port
}
func TestInvalidIPFamily(t *testing.T) {
	for _, test := range []struct {
		address string
		family  IPFamily
	}{{"localhost:0", "other"}, {"127.0.0.1:0", IPv6}, {"[::1]:0", IPv4}} {
		listeners, err := listenIP(test.address, test.family)
		closeListeners(listeners)
		if err == nil {
			t.Fatalf("accepted invalid policy: %+v", test)
		}
	}
}

func TestRunFactoryDualWebSocketIdentity(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	addresses := make(chan []net.Addr, 1)
	finished := make(chan error, 1)
	go func() {
		finished <- RunFactory(ctx, Options{Addr: "localhost:0", OnListen: func(bound []net.Addr) { addresses <- bound }}, func() abm.Model { return &abm.Base{} })
	}()
	var bound []net.Addr
	select {
	case bound = <-addresses:
	case err := <-finished:
		t.Fatalf("startup: %v", err)
	case <-time.After(3 * time.Second):
		t.Fatal("startup timed out")
	}
	var clients []*websocket.Conn
	defer func() {
		for _, client := range clients {
			client.Close()
		}
	}()
	for _, address := range bound {
		connection, _, err := websocket.DefaultDialer.Dial("ws://"+address.String(), nil)
		if err != nil {
			t.Fatal(err)
		}
		var info struct {
			Type    string `json:"type"`
			Payload struct {
				InstanceID string `json:"instance_id"`
			} `json:"payload"`
		}
		clients = append(clients, connection)
		err = connection.ReadJSON(&info)
		if err != nil {
			t.Fatal(err)
		}
		if info.Type != "simulator_info" || info.Payload.InstanceID == "" {
			t.Fatalf("invalid handshake: %+v", info)
		}
	}
	cancel()
	select {
	case err := <-finished:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("shutdown timed out")
	}
	for _, client := range clients {
		_ = client.SetReadDeadline(time.Now().Add(time.Second))
		if _, _, err := client.ReadMessage(); err == nil {
			t.Fatal("WebSocket remained open after shutdown")
		} else if timeout, ok := err.(net.Error); ok && timeout.Timeout() {
			t.Fatal("shutdown leaked an upgraded WebSocket")
		}
	}
}
