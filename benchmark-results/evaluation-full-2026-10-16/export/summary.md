# tensnap-paper-2026

Mode: publication. Source: f44651d75613e85d3865566ed4ee60610b1832d2.
Started: 2026-10-16T21:23:37.110Z. Every declared experiment passed offline verification.

Raw samples, compact manifests, checkpoints and logs are retained in `data.tar.gz`.
Original PNGs and plots are retained only in `figures.tar.gz`; paths and SHA-256 checks remain verifiable.
Gzip compression level: 6. Manifest and journal samples reference the checked samples.jsonl rows.
Use `pnpm evaluation extract --input EXPORT --out DIRECTORY --figures-only` to extract figures on demand.
CSV tables preserve full precision; LaTeX tables round displayed fractional values to three decimal places.
Performance measurement intervals are defined by each recorded profile; model-step and GUI intervals remain separate.

- conformance: complete
- schelling-workflow: complete
- protocol-core: complete
- schelling-kernel: complete
- schelling-ui-go: complete
- schelling-ui-js: complete
- schelling-ui-julia: complete
- schelling-ui-mesa: complete
- schelling-netlogo-render: complete
- fire-dqn: complete
