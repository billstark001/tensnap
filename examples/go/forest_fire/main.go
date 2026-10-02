package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
	"github.com/billstark001/tensnap/packages/tensnap-go/server"
)

func main() {
	defaults := DefaultConfig()
	port := flag.Int("port", 8765, "WebSocket server port")
	width := flag.Int("width", defaults.Width, "grid width")
	height := flag.Int("height", defaults.Height, "grid height")
	growth := flag.Float64("growth", defaults.Growth, "tree growth probability")
	lightning := flag.Float64("lightning", defaults.Lightning, "lightning probability")
	seed := flag.Uint("seed", uint(defaults.Seed), "random seed")
	flag.Parse()
	config := Config{Width: *width, Height: *height, Growth: *growth, Lightning: *lightning, Seed: uint32(*seed)}
	if config.Width <= 0 || config.Height <= 0 || !probability(config.Growth) || !probability(config.Lightning) {
		log.Fatal("dimensions must be positive; probabilities must be between 0 and 1")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	log.Printf("TenSnap forest-fire simulator -> ws://localhost:%d/", *port)
	if err := server.RunFactory(ctx, server.Options{Addr: fmt.Sprintf(":%d", *port)},
		func() abm.Model { return NewVizModel(config) }); err != nil {
		log.Fatal(err)
	}
}
