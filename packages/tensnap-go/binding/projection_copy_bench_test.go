package binding

import (
	"fmt"
	"os"
	"testing"

	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
)

func BenchmarkProjectionOwnership(b *testing.B) {
	phase := os.Getenv("TENSNAP_BENCH_PHASE")
	if phase == "" {
		phase = "diff"
	}
	if phase != "diff" && phase != "sync" {
		b.Fatal("TENSNAP_BENCH_PHASE must be diff or sync")
	}
	type model struct{ items []map[string]any }
	for _, count := range []int{100, 1000, 10000} {
		for _, shape := range []string{"scalar", "nested"} {
			for _, change := range []string{"unchanged", "changed"} {
				for _, mode := range []string{"builtin", "boundary", "custom", "owned", "double"} {
					b.Run(fmt.Sprintf("%d/%s/%s/%s", count, shape, change, mode), func(b *testing.B) {
						m := &model{items: make([]map[string]any, count)}
						for i := range m.items {
							m.items[i] = map[string]any{"id": i, "x": i}
							if shape == "nested" {
								m.items[i]["data"] = map[string]any{"count": i, "tags": []string{"ready"}}
							}
						}
						l := NewAgentLayer[*model, map[string]any]("agents").Items(func(m *model) []map[string]any { return m.items })
						if mode == "custom" || mode == "owned" {
							l.Project(func(_ *model, item map[string]any) map[string]any { return abm.SnapshotItem(item, mode == "owned") })
							if mode == "owned" {
								l.ProjectorOwnsValues(true)
							}
						} else {
							l.Field("id", func(_ *model, item map[string]any) any { return item["id"] }).Field("x", func(_ *model, item map[string]any) any { return item["x"] })
							if shape == "nested" {
								l.Field("data", func(_ *model, item map[string]any) any { return item["data"] })
							}
							if mode == "boundary" {
								l.ProjectorDeepCopy(false)
							}
							if mode == "double" {
								l.DeepCopy(true)
							}
						}
						l.computeDiffs(m)
						b.ReportAllocs()
						b.ResetTimer()
						for i := 0; i < b.N; i++ {
							if change == "changed" {
								for j := 0; j < max(1, count/100); j++ {
									m.items[j]["x"] = m.items[j]["x"].(int) + 1
									if shape == "nested" {
										data := m.items[j]["data"].(map[string]any)
										data["count"] = data["count"].(int) + 1
									}
								}
							}
							if phase == "sync" {
								l.diff.SeedOwned(l.projectItems(m, m.items))
							} else {
								l.computeDiffs(m)
							}
						}
					})
				}
			}
		}
	}
}
