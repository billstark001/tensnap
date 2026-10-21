package audit

import (
	shared "github.com/billstark001/tensnap/examples/go/internal/schelling"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestAuditIsReadOnlyAndReturnsFilesystemErrors(t *testing.T) {
	model := shared.NewSeededModel(shared.DefaultConfig(), 7)
	seed, draws := model.RNGPosition()
	cells := append([]shared.Cell(nil), model.Cells...)
	path := filepath.Join(t.TempDir(), "state.json")
	if err := Writer(path)(model); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
	afterSeed, afterDraws := model.RNGPosition()
	if seed != afterSeed || draws != afterDraws || !reflect.DeepEqual(cells, model.Cells) {
		t.Fatal("audit changed the model")
	}
	if err := Writer(filepath.Join(path, "missing.json"))(model); err == nil {
		t.Fatal("expected a returned filesystem error")
	}
}
