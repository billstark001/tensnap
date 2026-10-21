package schelling

import (
	"reflect"
	"testing"
)

func TestSeededResetObservationAndInterleaving(t *testing.T) {
	config := DefaultConfig()
	config.GridWidth, config.GridHeight = 9, 7
	a, b, other := NewSeededModel(config, 7), NewSeededModel(config, 7), NewSeededModel(config, 29)
	initial := a.captureCheckpoint()
	for tick := 0; tick < 8; tick++ {
		if !reflect.DeepEqual(a.captureCheckpoint(), b.captureCheckpoint()) {
			t.Fatal("same seed diverged")
		}
		before := a.captureCheckpoint()
		a.SatisfiedPct()
		a.SegregationIndex()
		for index := range a.Cells {
			if a.Cells[index].Group != 0 {
				a.Satisfied(index)
			}
		}
		if !reflect.DeepEqual(before, a.captureCheckpoint()) {
			t.Fatal("observation changed model or RNG")
		}
		a.Step()
		other.Step()
		b.Step()
	}
	a.Initialize()
	if !reflect.DeepEqual(initial, a.captureCheckpoint()) {
		t.Fatal("reset did not repeat the initialized state")
	}
}

func TestCheckpointPreservesActiveRNGAndNextResetSeed(t *testing.T) {
	config := DefaultConfig()
	config.GridWidth, config.GridHeight = 9, 7
	model := NewSeededModel(config, 7)
	model.Step()
	model.Config.Seed = 8 // An initialization parameter must not reseed a running model.
	saved := model.captureCheckpoint()
	model.Step()
	model.Step()
	expected := model.captureCheckpoint()
	if err := model.restoreCheckpoint(saved); err != nil {
		t.Fatal(err)
	}
	model.Step()
	model.Step()
	if !reflect.DeepEqual(expected, model.captureCheckpoint()) {
		t.Fatal("checkpoint continuation diverged")
	}
	model.Initialize()
	reference := NewSeededModel(config, 8)
	if !reflect.DeepEqual(model.captureCheckpoint(), reference.captureCheckpoint()) {
		t.Fatal("pending seed lost")
	}
}

func TestStudySeparatesJammingAndSatisfaction(t *testing.T) {
	config := DefaultConfig()
	config.GridWidth, config.GridHeight, config.Density, config.SimilarityThreshold = 5, 5, 1, 1
	trial := RunTrial(config, 7, 10, StudyConvergence)
	if trial.Termination != "jammed" || trial.Satisfied >= 1 || trial.StepsRun != 1 {
		t.Fatalf("unexpected result: %+v", trial)
	}
	config.SimilarityThreshold = 0
	if trial := RunTrial(config, 7, 10, StudyConvergence); trial.Termination != "satisfied" {
		t.Fatalf("unexpected result: %+v", trial)
	}
}
