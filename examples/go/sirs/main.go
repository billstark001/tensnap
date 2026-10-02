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
	rows := flag.Int("rows", defaults.Rows, "grid rows")
	cols := flag.Int("cols", defaults.Cols, "grid columns")
	beta := flag.Float64("beta", defaults.Beta, "infection rate")
	gamma := flag.Float64("gamma", defaults.Gamma, "recovery rate")
	xi := flag.Float64("xi", defaults.Xi, "loss of immunity rate")
	initial := flag.Int("initial-infected", defaults.InitialInfected, "initial infected people")
	seed := flag.Uint("seed", uint(defaults.Seed), "random seed")
	flag.Parse()
	config := Config{Rows: *rows, Cols: *cols, Beta: *beta, Gamma: *gamma, Xi: *xi,
		InitialInfected: *initial, Seed: uint32(*seed)}
	if config.Rows <= 0 || config.Cols <= 0 || config.InitialInfected < 0 ||
		!probability(config.Beta) || !probability(config.Gamma) || !probability(config.Xi) {
		log.Fatal("rows and cols must be positive; probabilities must be between 0 and 1")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	log.Printf("TenSnap SIRS simulator -> ws://localhost:%d/", *port)
	if err := server.RunFactory(ctx, server.Options{Addr: fmt.Sprintf(":%d", *port)},
		func() abm.Model { return NewVizModel(config) }); err != nil {
		log.Fatal(err)
	}
}
