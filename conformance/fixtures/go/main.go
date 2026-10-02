// Deterministic Go binding host for the cross-binding wire probe.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
	"github.com/billstark001/tensnap/packages/tensnap-go/binding"
	"github.com/billstark001/tensnap/packages/tensnap-go/protocol"
	"github.com/billstark001/tensnap/packages/tensnap-go/server"
)

func persist(model *CounterModel) {
	raw, err := json.Marshal(model.Snapshot())
	if err != nil {
		panic(err)
	}
	if err := os.WriteFile(os.Getenv("TENSNAP_CONFORMANCE_STATE"), raw, 0600); err != nil {
		panic(err)
	}
}

func main() {
	port, err := strconv.Atoi(os.Getenv("TENSNAP_CONFORMANCE_PORT"))
	if err != nil {
		log.Fatal(err)
	}
	s := NewCounterModel()
	persist(s)
	var model *binding.Model[*CounterModel]
	publish := func(e abm.Emitter) error {
		if err := model.PushEnvDiffs(e); err != nil {
			return err
		}
		if err := model.PushCharts(e, float64(model.Tick())); err != nil {
			return err
		}
		return model.PushMonitors(e)
	}
	version := "1"
	options := []binding.ModelOption[*CounterModel]{
		binding.WithSimulatorInfo[*CounterModel](protocol.SimulatorInfoPayload{Model: protocol.ModelInfo{ID: "conformance.counter", StateSchemaVersion: &version}}),
		binding.WithInit(func(m *CounterModel) error { persist(m); return nil }),
		binding.WithStep(func(m *CounterModel) (bool, error) {
			m.Step()
			persist(m)
			return true, nil
		}),
		binding.WithParams(binding.NumberParam("speed", "Speed", func(m *CounterModel) float64 { return m.Speed },
			func(m *CounterModel, value float64) error { m.SetSpeed(value); persist(m); return nil }).Range(0, 5).Step(1).Runtime(true).Build()),
		binding.WithMonitors(binding.NewMonitor("position", "Position", func(m *CounterModel) any { return m.X })),
		binding.WithMonitors(binding.NewMonitor("population", "Population", func(m *CounterModel) any { return len(m.Agents) })),
		binding.WithActions(
			binding.NewAction("fail", "Fail", func(_ *CounterModel) error { return errors.New("intentional handler failure") }),
			binding.NewEmissiveAction("seed_dense", "Seed Dense Population", func(m *CounterModel, e abm.Emitter) (bool, error) {
				m.SeedDense()
				persist(m)
				return false, publish(e)
			}),
			binding.NewEmissiveAction("clear_population", "Clear Population", func(m *CounterModel, e abm.Emitter) (bool, error) {
				m.ClearPopulation()
				persist(m)
				return false, publish(e)
			}),
		),
		binding.WithEnvs(binding.NewEnv("study",
			binding.NewGridLayer[*CounterModel]("grid").Size(func(_ *CounterModel) (int, int) { return 64, 64 }),
			binding.NewAgentLayer[*CounterModel, Agent]("agents").
				Size(func(_ *CounterModel) (int, int) { return 64, 64 }).
				Items(func(m *CounterModel) []Agent { return m.Agents }).
				Project(func(_ *CounterModel, a Agent) map[string]any {
					return map[string]any{"id": a.ID, "x": a.X, "y": a.Y,
						"color": map[string]string{"S": "#3498db", "I": "#e74c3c", "R": "#2ecc71"}[a.Health],
						"data":  map[string]any{"health": a.Health}}
				}),
		)),
		binding.WithCharts(binding.NewChartGroup("health", "Health states",
			binding.NewChartSeries("susceptible", "Susceptible", "#3498db", func(m *CounterModel) any { s, _, _ := m.Counts(); return s }),
			binding.NewChartSeries("infected", "Infected", "#e74c3c", func(m *CounterModel) any { _, i, _ := m.Counts(); return i }),
			binding.NewChartSeries("recovered", "Recovered", "#2ecc71", func(m *CounterModel) any { _, _, r := m.Counts(); return r }),
		)),
		binding.WithRestoreTime(func(_ *CounterModel, _ float64) error { return nil }),
	}
	if os.Getenv("TENSNAP_CONFORMANCE_NO_CHECKPOINT") != "1" {
		options = append(options, binding.WithTypedCheckpoint((*CounterModel).Snapshot, func(m *CounterModel, saved CounterModel) error { m.Restore(saved); persist(m); return nil }))
	}
	model = binding.NewModel(s, options...)
	codec := protocol.Codec(protocol.JSONCodec{})
	if os.Getenv("TENSNAP_CONFORMANCE_ENCODING") == "msgpack" {
		codec = protocol.MsgPackCodec{}
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := server.Run(ctx, server.Options{Addr: fmt.Sprintf("127.0.0.1:%d", port), Codec: codec}, model); err != nil {
		log.Fatal(err)
	}
}
