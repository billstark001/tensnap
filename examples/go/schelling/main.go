package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	shared "github.com/billstark001/tensnap/examples/go/internal/schelling"
	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
	"github.com/billstark001/tensnap/packages/tensnap-go/server"
)

func main() {
	gridWidth := flag.Int("grid-width", 50, "Schelling grid width")
	gridHeight := flag.Int("grid-height", 50, "Schelling grid height")
	flag.IntVar(gridWidth, "width", 50, "Schelling grid width (alias for -grid-width)")
	flag.IntVar(gridHeight, "height", 50, "Schelling grid height (alias for -grid-height)")
	density := flag.Float64("density", 0.8, "Initial occupied density")
	balance := flag.Float64("balance", 0.5, "Share of group 1 among occupied cells")
	threshold := flag.Float64("threshold", 0.7, "Required same-group neighbour ratio")
	seed := flag.Int64("seed", 7, "Deterministic model seed")
	port := flag.Int("port", 8765, "WebSocket server port")
	flag.Parse()

	config := shared.Config{
		GridWidth:           *gridWidth,
		GridHeight:          *gridHeight,
		SimilarityThreshold: *threshold,
		Density:             *density,
		Balance:             *balance,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	log.Printf("TenSnap simulator -> ws://localhost:%d/", *port)
	if err := server.RunFactory(ctx, server.Options{Addr: fmt.Sprintf(":%d", *port)}, func() abm.Model {
		// RunFactory may create more than one session while a renderer reconnects.
		// Give every session a fresh, identically seeded model so a benchmark
		// replicate never inherits state from an endpoint readiness check.
		model := shared.NewModel(config)
		model.SetSeed(*seed)
		return shared.NewVizModel(model)
	}); err != nil {
		log.Fatal(err)
	}
}
