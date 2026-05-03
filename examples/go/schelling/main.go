package main

import (
	"context"
	"flag"
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
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	log.Println("TenSnap simulator -> ws://localhost:8080/ws")
	if err := server.RunFactory(ctx, server.Options{Addr: ":8080"}, func() abm.Model {
		return shared.NewWithConfig(shared.Config{GridWidth: *gridWidth, GridHeight: *gridHeight})
	}); err != nil {
		log.Fatal(err)
	}
}
