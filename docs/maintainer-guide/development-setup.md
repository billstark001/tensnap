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
pnpm dev:web  # Starts at http://localhost:3000
```

**Python simulation examples:**

```bash
pnpm dev:py:flock      # Flocking behavior
pnpm dev:py:hk         # Hegselmann-Krause opinion dynamics
pnpm dev:py:sirs:grid  # SIRS epidemic on grid
```

**Tauri desktop app:**

```bash
pnpm dev:tauri
```

### Project Structure

```
tensnap/
├── docs/                    # Documentation
├── packages/
│   ├── tensnap-python/      # Python backend (WebSocket server)
│   ├── tensnap-web/         # Web frontend (React + Vite)
│   ├── tensnap-web-utils/   # Shared web utilities
│   └── tensnap-tauri/       # Desktop app (Tauri + Rust)
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

Or use the pnpm script:

```bash
pnpm --filter tensnap-python lint
```

### TypeScript

**Linting:**

```bash
pnpm lint              # All packages
pnpm --filter tensnap-web lint  # Specific package
```

## Testing

### Python

Currently no test suite (tests directory doesn't exist). Tests can be added to `packages/tensnap-python/tests/`.

### TypeScript

Test infrastructure is configured but no tests are implemented yet:

```bash
pnpm test              # All packages
pnpm --filter tensnap-web test  # Specific package
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
- [Protocol Documentation](./protocol.md) - WebSocket communication protocol
- [Contributing Guidelines](./contributing.md) - Contribution workflow
