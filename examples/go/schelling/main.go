// This user launcher delegates to the reset-safe server shared with the
// benchmark adapter. The split is repository reuse, not Go binding boilerplate.
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
	defaults := shared.DefaultConfig()
	gridWidth := flag.Int("width", defaults.GridWidth, "Schelling grid width")
	gridHeight := flag.Int("height", defaults.GridHeight, "Schelling grid height")
	density := flag.Float64("density", defaults.Density, "Initial occupied density")
	balance := flag.Float64("balance", defaults.Balance, "Share of group 1 among occupied cells")
	threshold := flag.Float64("threshold", defaults.SimilarityThreshold, "Required same-group neighbour ratio")
	seed := flag.Int64("seed", 7, "Deterministic model seed")
	port := flag.Int("port", 8765, "WebSocket server port")
	flag.Parse()

	config := shared.Config{Seed: *seed, GridWidth: *gridWidth, GridHeight: *gridHeight, SimilarityThreshold: *threshold, Density: *density, Balance: *balance}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	log.Printf("TenSnap simulator -> ws://localhost:%d/", *port)
	if err := shared.RunTenSnapServer(ctx, config, *port); err != nil {
		log.Fatal(err)
	}
}
