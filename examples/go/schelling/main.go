package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	shared "github.com/billstark001/tensnap/examples/go/internal/schelling"
	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
	"github.com/billstark001/tensnap/packages/tensnap-go/server"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	log.Println("TenSnap simulator -> ws://localhost:8080/ws")
	if err := server.RunFactory(ctx, server.Options{Addr: ":8080"}, func() abm.Model {
		return shared.New()
	}); err != nil {
		log.Fatal(err)
	}
}
