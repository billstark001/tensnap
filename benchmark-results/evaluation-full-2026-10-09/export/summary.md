# tensnap-paper-2026

Mode: publication. Source: c80c882396beb4b4da0703616b8af7c10de0534b.
Started: 2026-10-10T00:17:44.660Z. Every declared experiment passed offline verification.

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
