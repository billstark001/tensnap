# Development Setup

Quick guide to set up a development environment for TenSnap.

## Prerequisites

- **Git**: Version control
- **Python 3.10+**: For Python backend
- **Node.js 18+** and **pnpm 8+**: For web frontend
- **Rust & Cargo**: For Tauri desktop app (optional)

## Setup Steps

### 1. Clone Repository

```bash
git clone https://github.com/billstark001/tensnap.git
cd tensnap
```

### 2. Install Dependencies

**JavaScript/TypeScript:**

```bash
pnpm install  # Installs all workspace packages
```

**Python:**

```bash
cd packages/tensnap-python
python -m venv venv
source venv/bin/activate  # Windows: .\venv\Scripts\activate
pip install -e ".[dev]"
```

## Development Workflow

### Running in Development

**Web frontend:**

```bash
pnpm dev:web  # Starts at http://localhost:3200
```

**Python simulation examples:**

```bash
# Using pnpm scripts from repository root
pnpm dev:py:flock      # Flocking behavior
pnpm dev:py:hk         # Hegselmann-Krause opinion dynamics
pnpm dev:py:sirs:grid  # SIRS epidemic on grid
pnpm dev:py:cgol       # Conway's Game of Life (Mesa)
pnpm dev:py:sugarscape # Sugarscape (Mesa)
pnpm dev:py:mushroom   # Mushroom foraging (Mesa)

# Or run directly from examples directory
cd examples/python
python flock_viz.py

cd examples/python_mesa
python cgol_viz.py
```

**Tauri desktop app:**

```bash
pnpm dev:tauri
```

### Project Structure

```
tensnap/
├── docs/                    # Documentation
├── examples/
│   ├── js/                  # JavaScript examples and local simulator manifests
│   ├── python/              # Python examples (non-Mesa)
│   └── python_mesa/         # Python examples (Mesa-based)
├── packages/
│   ├── benchmark/           # Benchmarks for render/runtime paths
│   ├── core/                # Shared protocol, Scenario, runtime, rendering primitives
│   ├── tensnap-agent/       # Headless runtime and agent/session tooling
│   ├── tensnap-python/      # Python bindings and runtime integration
│   ├── tensnap-tauri/       # Desktop app (Tauri + Rust)
│   ├── tensnap-web/         # Web frontend (React + Vite)
│   ├── web-adapter/         # Browser-side filesystem/integration helpers
│   └── web-common/          # Shared browser UI/types/helpers
└── package.json             # Workspace root
```

## Code Quality

### Python

**Linting and formatting:**

```bash
cd packages/tensnap-python
ruff format tensnap/  # Format code
ruff check tensnap/   # Lint
mypy tensnap/         # Type check
```

Repository-wide frontend/tooling lint can be run from the workspace root:

```bash
pnpm lint
```

### TypeScript

**Linting:**

```bash
pnpm lint  # All workspace packages
```

## Testing

### Python

Python tests live in `packages/tensnap-python/tests/`:

```bash
cd packages/tensnap-python
pytest
```

### TypeScript

The repository already includes TypeScript/Vitest coverage in multiple packages:

```bash
pnpm test              # All packages
```

## Building

```bash
pnpm build:web    # Web frontend → packages/tensnap-web/dist/
pnpm build:tauri  # Desktop app → packages/tensnap-tauri/src-tauri/target/release/
```

## IDE Setup (Optional)

### VS Code

Recommended extensions: Python, Pylance, Ruff, ESLint, Rust Analyzer (for Tauri)

Configure Python interpreter to use `packages/tensnap-python/venv/bin/python`.

## Troubleshooting

**Python module not found:**

```bash
source packages/tensnap-python/venv/bin/activate
pip install -e ".[dev]"
```

**TypeScript errors:**

```bash
pnpm clean
pnpm install
```

**WebSocket connection fails:**

Ensure Python simulation server is running first (e.g., `pnpm dev:py:flock`), then start web frontend.

**Build fails:**

```bash
pnpm clean
pnpm install
pnpm build:web
```

## Next Steps

- [Architecture Documentation](./architecture.md) - System design and components
- [Protocol v0.2](./protocol-v0.2.md) - Current renderer/simulator protocol
- [Contributing Guidelines](./contributing.md) - Contribution workflow
