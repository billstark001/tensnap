# Development Setup

This guide will help you set up a complete development environment for contributing to TenSnap.

## Prerequisites

### Required Software

- **Git**: Version control
- **Python 3.10+**: For Python bindings
- **Node.js 18+**: For web frontend
- **pnpm 8+**: Package manager (preferred over npm)
- **Rust & Cargo**: For Tauri desktop app (optional)

### Recommended Tools

- **VS Code** or **PyCharm**: IDE with good TypeScript/Python support
- **Python Virtual Environment**: `venv` or `conda`
- **Git GUI**: GitHub Desktop, GitKraken, or similar (optional)

## Initial Setup

### 1. Fork and Clone

Fork the repository on GitHub, then clone your fork:

```bash
git clone https://github.com/YOUR_USERNAME/tensnap.git
cd tensnap
```

Add upstream remote:

```bash
git remote add upstream https://github.com/billstark001/tensnap.git
```

### 2. Install pnpm

If you don't have pnpm:

```bash
npm install -g pnpm
```

### 3. Install Dependencies

#### JavaScript Dependencies

```bash
# From repository root
pnpm install
```

This installs dependencies for all workspace packages.

#### Python Dependencies

```bash
cd packages/tensnap-python
python -m venv venv  # Create virtual environment

# Activate virtual environment
source venv/bin/activate  # On macOS/Linux
# or
.\venv\Scripts\activate  # On Windows

# Install in development mode with all dev dependencies
pip install -e ".[dev]"
```

### 4. Verify Installation

Test that everything works:

```bash
# Test Python bindings
python -c "import tensnap; print(tensnap.__version__)"

# Test web build
cd ../..  # Back to repo root
pnpm build:web

# Run tests
pnpm test
```

## Development Workflow

### Running in Development Mode

#### Web Frontend

```bash
pnpm dev:web
```

This starts Vite development server at `http://localhost:5173` with:
- Hot module replacement
- Fast refresh
- TypeScript type checking

#### Python Simulation

In a separate terminal:

```bash
# Activate virtual environment first
source packages/tensnap-python/venv/bin/activate

# Run an example
pnpm dev:py:flock  # or dev:py:hk
```

Or run directly:

```bash
cd packages/tensnap-python/tensnap/examples
python flock_viz.py
```

#### Tauri Desktop App

```bash
pnpm dev:tauri
```

This builds and runs the desktop application.

### Project Structure

```
tensnap/
├── docs/                        # Documentation
├── packages/
│   ├── tensnap-python/          # Python bindings
│   │   ├── tensnap/
│   │   │   ├── __init__.py
│   │   │   ├── server.py
│   │   │   ├── simulation.py
│   │   │   ├── models/
│   │   │   ├── bindings/
│   │   │   └── examples/
│   │   ├── tests/               # Python tests
│   │   ├── pyproject.toml       # Python package config
│   │   └── package.json         # Scripts
│   │
│   ├── tensnap-web/             # Web frontend
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   ├── store/
│   │   │   ├── types/
│   │   │   └── utils/
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   └── jest.config.js
│   │
│   └── tensnap-tauri/           # Desktop app
│       ├── src/                 # Web UI (reuses tensnap-web)
│       └── src-tauri/           # Rust backend
│           ├── src/
│           └── Cargo.toml
│
├── package.json                 # Root package (workspaces)
├── pnpm-workspace.yaml          # pnpm workspace config
└── tsconfig.base.json           # Base TypeScript config
```

## Making Changes

### Branch Strategy

Create a feature branch for your changes:

```bash
git checkout -b feature/your-feature-name
```

Branch naming conventions:
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Test additions/changes

### Python Development

#### Code Style

TenSnap uses:
- **black**: Code formatting
- **ruff**: Linting
- **mypy**: Type checking

Format and lint your code:

```bash
cd packages/tensnap-python

# Format with black
black tensnap/

# Lint with ruff
ruff check tensnap/

# Type check with mypy
mypy tensnap/
```

#### Running Tests

```bash
cd packages/tensnap-python

# Run all tests
pytest

# Run with coverage
pytest --cov=tensnap --cov-report=html

# Run specific test file
pytest tests/test_server.py

# Run specific test
pytest tests/test_server.py::test_server_creation
```

#### Writing Tests

Place tests in `packages/tensnap-python/tests/`:

```python
# tests/test_my_feature.py
import pytest
from tensnap import TenSnapServer

def test_server_creation():
    """Test that server can be created"""
    server = TenSnapServer(port=8765)
    assert server.port == 8765

@pytest.mark.asyncio
async def test_server_start():
    """Test async server functionality"""
    server = TenSnapServer()
    # Test async code here
```

### TypeScript/React Development

#### Code Style

- **ESLint**: JavaScript/TypeScript linting
- **Prettier**: Code formatting (integrated with ESLint)

Lint your code:

```bash
cd packages/tensnap-web

# Run ESLint
pnpm lint

# Auto-fix issues
pnpm lint --fix
```

#### Running Tests

```bash
cd packages/tensnap-web

# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# With coverage
pnpm test -- --coverage
```

#### Writing Tests

Place tests next to components or in `src/test/`:

```typescript
// src/components/MyComponent.test.tsx
import { render, screen } from '@testing-library/react';
import { MyComponent } from './MyComponent';

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });
});
```

### Building for Production

#### Python Package

```bash
cd packages/tensnap-python
python -m build
# Creates dist/tensnap-*.whl and dist/tensnap-*.tar.gz
```

#### Web Frontend

```bash
pnpm build:web
# Output in packages/tensnap-web/dist/
```

#### Tauri Desktop App

```bash
pnpm build:tauri
# Output in packages/tensnap-tauri/src-tauri/target/release/
```

## IDE Setup

### VS Code

Recommended extensions:

```json
{
  "recommendations": [
    "ms-python.python",
    "ms-python.vscode-pylance",
    "charliermarsh.ruff",
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "bradlc.vscode-tailwindcss",
    "rust-lang.rust-analyzer"
  ]
}
```

Workspace settings (`.vscode/settings.json`):

```json
{
  "python.defaultInterpreterPath": "${workspaceFolder}/packages/tensnap-python/venv/bin/python",
  "python.linting.enabled": true,
  "python.linting.ruffEnabled": true,
  "python.formatting.provider": "black",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[python]": {
    "editor.defaultFormatter": "ms-python.black-formatter"
  }
}
```

### PyCharm

1. Open project root as a new project
2. Configure Python interpreter:
   - File → Settings → Project → Python Interpreter
   - Add interpreter → Existing environment
   - Select `packages/tensnap-python/venv/bin/python`
3. Enable type checking:
   - Settings → Tools → Python Integrated Tools
   - Type checker: mypy
4. Configure code style:
   - Settings → Editor → Code Style → Python
   - Scheme: Black

## Debugging

### Python Debugging

#### VS Code

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Python: Current File",
      "type": "python",
      "request": "launch",
      "program": "${file}",
      "console": "integratedTerminal",
      "cwd": "${workspaceFolder}/packages/tensnap-python"
    },
    {
      "name": "Python: Example (Flock)",
      "type": "python",
      "request": "launch",
      "program": "${workspaceFolder}/packages/tensnap-python/tensnap/examples/flock_viz.py",
      "console": "integratedTerminal"
    }
  ]
}
```

#### PyCharm

- Right-click on any Python file → Debug

### Frontend Debugging

#### Browser DevTools

1. Run `pnpm dev:web`
2. Open `http://localhost:5173`
3. Press F12 for DevTools
4. Sources tab → Add breakpoints in TypeScript files

#### VS Code

Add to `.vscode/launch.json`:

```json
{
  "name": "Chrome: Debug Frontend",
  "type": "chrome",
  "request": "launch",
  "url": "http://localhost:5173",
  "webRoot": "${workspaceFolder}/packages/tensnap-web/src"
}
```

## Common Tasks

### Adding a New Python Module

1. Create file in `packages/tensnap-python/tensnap/`
2. Add exports to `__init__.py`
3. Write tests in `tests/`
4. Add type hints
5. Document with docstrings

### Adding a New React Component

1. Create file in `packages/tensnap-web/src/components/`
2. Create styles (CSS-in-JS or external)
3. Export from `index.ts` if needed
4. Write tests (`.test.tsx`)
5. Add to Storybook (if applicable)

### Adding a New Example

1. Create pure simulation in `examples/my_model.py`
2. Create visualization in `examples/my_model_viz.py`
3. Add run script to `package.json`:
   ```json
   "scripts": {
     "dev:py:my_model": "..."
   }
   ```
4. Document in example's docstring

## Troubleshooting

### Issue: Python module not found

**Solution**: Ensure virtual environment is activated and package is installed in editable mode:
```bash
pip install -e ".[dev]"
```

### Issue: TypeScript errors

**Solution**: Rebuild TypeScript definitions:
```bash
cd packages/tensnap-web
rm -rf node_modules
pnpm install
```

### Issue: WebSocket connection fails

**Solution**: 
- Ensure Python server is running first
- Check port (default 8765)
- Check firewall settings

### Issue: Tests fail with "module not found"

**Solution**: Install test dependencies:
```bash
pip install -e ".[dev]"  # Python
pnpm install             # JavaScript
```

### Issue: Build fails

**Solution**:
```bash
# Clean and rebuild
pnpm clean
pnpm install
pnpm build:web
```

## Getting Help

- **Check Documentation**: Start with the [User Guide](../user-guide/user-guide.md)
- **Search Issues**: Check existing [GitHub issues](https://github.com/billstark001/tensnap/issues)
- **Ask Questions**: Open a new issue with the "question" label
- **Join Discussions**: Use GitHub Discussions for general questions

## Next Steps

- **[Contributing Guidelines](./contributing.md)** - How to contribute code
- **[Architecture Documentation](./architecture.md)** - Understanding the codebase
- **[Protocol Documentation](./protocol.md)** - WebSocket protocol details
