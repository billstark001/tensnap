// Publication flags/version adapter over the example's shared server.
package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"

	shared "github.com/billstark001/tensnap/examples/go/internal/schelling"
)

func main() {
	if shared.DynamicsVersion != 1 {
		panic("benchmark adapter requires Schelling dynamics v1")
	}
	defaults := shared.DefaultConfig()
	gridWidth := flag.Int("grid-width", defaults.GridWidth, "Schelling grid width")
	gridHeight := flag.Int("grid-height", defaults.GridHeight, "Schelling grid height")
	flag.IntVar(gridWidth, "width", defaults.GridWidth, "alias for -grid-width")
	flag.IntVar(gridHeight, "height", defaults.GridHeight, "alias for -grid-height")
	density := flag.Float64("density", defaults.Density, "Initial occupied density")
	balance := flag.Float64("balance", defaults.Balance, "Share of group 1 among occupied cells")
	threshold := flag.Float64("threshold", defaults.SimilarityThreshold, "Required same-group neighbour ratio")
	seed := flag.Int64("seed", 7, "Deterministic model seed")
	port := flag.Int("port", 8765, "WebSocket server port")
	flag.Parse()

	config := shared.Config{GridWidth: *gridWidth, GridHeight: *gridHeight, SimilarityThreshold: *threshold, Density: *density, Balance: *balance}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	log.Printf("TenSnap simulator -> ws://localhost:%d/", *port)
	if err := shared.RunTenSnapServer(ctx, config, *seed, *port); err != nil {
		log.Fatal(err)
	}
}
