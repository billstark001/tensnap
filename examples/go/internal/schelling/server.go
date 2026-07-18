// Server construction is shared by teaching and benchmark launchers to keep
// fresh-session/reset semantics identical.
package schelling

import (
	"context"
	"fmt"

	"github.com/billstark001/tensnap/packages/tensnap-go/abm"
	"github.com/billstark001/tensnap/packages/tensnap-go/server"
)

// RunTenSnapServer gives every connection a fresh model with the same seed.
// This is useful for reconnecting teaching clients as well as reproducible tests.
func RunTenSnapServer(ctx context.Context, config Config, seed int64, port int) error {
	if port <= 0 || port > 65_535 {
		return fmt.Errorf("port must be an integer from 1 through 65535")
	}
	return server.RunFactory(ctx, server.Options{Addr: fmt.Sprintf(":%d", port)}, func() abm.Model {
		model := NewModel(config)
		model.SetSeed(seed)
		// The binding's init hook performs the one seeded initialization that is
		// visible to this session.
		return NewVizModel(model)
	})
}
