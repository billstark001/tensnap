package main

import (
	"reflect"
	"testing"
)

func TestCheckpointResumesSameSIRSStep(t *testing.T) {
	config := DefaultConfig()
	config.Rows, config.Cols = 6, 7
	m := NewModel(config)
	for range 8 {
		m.Step()
	}
	saved := m.Snapshot()
	m.Step()
	want := m.Snapshot()
	if err := m.Restore(saved); err != nil {
		t.Fatal(err)
	}
	m.Step()
	if !reflect.DeepEqual(m.Snapshot(), want) {
		t.Fatal("checkpoint did not resume the same SIRS path")
	}
}

func TestProjectedSIRSLayerRestoresHealthStates(t *testing.T) {
	config := DefaultConfig()
	config.Rows, config.Cols = 3, 4
	m := NewModel(config)
	items := make([]map[string]any, len(m.People))
	for id, person := range m.People {
		items[id] = map[string]any{
			"id": person.ID, "x": id % m.Cols, "y": id / m.Cols,
			"data": map[string]any{"state": person.State},
		}
	}
	m.Step()
	if err := restorePeople(m, items); err != nil {
		t.Fatal(err)
	}
	for id, item := range items {
		if m.People[id].State != item["data"].(map[string]any)["state"] {
			t.Fatal("projected health state was not restored")
		}
	}
}

func TestSIRSCardinalSpreadAndRecoveryCycle(t *testing.T) {
	config := DefaultConfig()
	config.Rows, config.Cols = 3, 3
	config.InitialInfected = 0
	config.Beta, config.Gamma, config.Xi = 1, 0, 0
	m := NewModel(config)
	m.People[4].State = infected
	m.Step()
	for id, person := range m.People {
		want := susceptible
		if id == 1 || id == 3 || id == 4 || id == 5 || id == 7 {
			want = infected
		}
		if person.State != want {
			t.Fatalf("first SIRS step at %d: got %s, want %s", id, person.State, want)
		}
	}
	m.Step()
	_, infectedCount, recoveredCount := m.Counts()
	if infectedCount != 9 || recoveredCount != 0 {
		t.Fatalf("second SIRS step did not infect the corners: I=%d R=%d", infectedCount, recoveredCount)
	}
	m.Beta, m.Gamma = 0, 1
	m.Step()
	_, infectedCount, recoveredCount = m.Counts()
	if infectedCount != 0 || recoveredCount != 9 {
		t.Fatalf("recovery phase failed: I=%d R=%d", infectedCount, recoveredCount)
	}
	m.Gamma, m.Xi = 0, 1
	m.Step()
	susceptibleCount, infectedCount, recoveredCount := m.Counts()
	if susceptibleCount != 9 || infectedCount != 0 || recoveredCount != 0 {
		t.Fatalf("loss-of-immunity phase failed: S=%d I=%d R=%d", susceptibleCount, infectedCount, recoveredCount)
	}
}
