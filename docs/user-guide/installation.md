# Installation Guide

This guide covers different ways to install and run TenSnap depending on your use case.

## Prerequisites

### For Python Users

- **Python 3.10 or higher**
- **pip** (Python package manager)

### For Web Interface Development

- **Node.js 18.0 or higher**
- **pnpm 8.0 or higher** (preferred package manager)

### For Desktop Application

- **Rust and Cargo** (for building Tauri)
- All prerequisites for Web Interface Development

## Installation Methods

### Method 1: Development Installation (Recommended)

This method is best for trying TenSnap, developing models, or contributing to the project.

#### 1. Clone the Repository

```bash
git clone https://github.com/billstark001/tensnap.git
cd tensnap
```

#### 2. Install Python Bindings

```bash
cd packages/tensnap-python
pip install -e .  # Editable install for development
```

Or with optional development dependencies:

```bash
pip install -e ".[dev]"  # Includes pytest, mypy, ruff, black
```

#### 3. Install JavaScript Dependencies

```bash
# From repository root
cd ../..
pnpm install
```

### Method 2: Python Package Only

If you only need the Python bindings (no web interface development):

```bash
git clone https://github.com/billstark001/tensnap.git
cd tensnap/packages/tensnap-python
pip install .
```

### Method 3: Desktop Application (Tauri)

For a standalone desktop application:

#### Install Rust

```bash
# On macOS/Linux
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# On Windows, download from https://rustup.rs/
```

#### Install System Dependencies

**macOS:**

```bash
xcode-select --install
```

**Linux (Ubuntu/Debian):**

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.0-dev \
    build-essential \
    curl \
    wget \
    file \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev
```

#### Build Tauri Application

```bash
# From repository root
pnpm install
pnpm build:tauri
```

The built application will be in `packages/tensnap-tauri/src-tauri/target/release/`.

## Verifying Installation

### Test Python Installation

```python
import tensnap
print(tensnap.__version__)  # Should print version number

# Test basic components
from tensnap import TenSnapServer, AgentModel, GridEnvironmentModel
server = TenSnapServer(port=8765)
print("TenSnap Python bindings installed successfully!")
```

### Test Web Interface

```bash
# From repository root
pnpm dev:web
```

This should start a development server, default at `http://localhost:3200`. Configure the port by editing Vite's config file.

### Run Example Simulation

```bash
# From repository root (using pnpm script)
pnpm dev:py:flock

# Or run directly from examples directory
cd examples/python
python flock_viz.py
```

This will start the flocking simulation and open the web interface.

## Platform-Specific Notes

### macOS

- Apple Silicon (M1/M2) users should ensure they have the correct Python architecture
- You may need to allow the application in System Preferences > Security & Privacy

### Linux

- Ensure WebKit2GTK is installed for Tauri support
- Some distributions may require additional dependencies

### Windows

- Use PowerShell or Command Prompt with administrator privileges for some operations
- Windows Subsystem for Linux (WSL2) is recommended for development

## Development Dependencies

### Python Development Tools

The development installation includes:

- **pytest**: Testing framework
- **pytest-asyncio**: Async test support
- **pytest-cov**: Code coverage
- **mypy**: Static type checking
- **ruff**: Fast Python linter
- **black**: Code formatter

### JavaScript Development Tools

Included in the monorepo:

- **TypeScript**: Type-safe JavaScript
- **Vite**: Fast build tool
- **ESLint**: JavaScript linter
- **Vitest**: Testing framework
- **React Testing Library**: Component testing

## Optional Dependencies

### For NumPy Array Visualization

```bash
pip install numpy>=1.24.0
```

### For Network/Graph Models

```bash
pip install networkx>=3.0
```

These are already included in the base installation, but mentioned for completeness.

## Updating TenSnap

### Development Installation

```bash
cd tensnap
git pull origin main

# Update Python packages
cd packages/tensnap-python
pip install -e ".[dev]"

# Update JavaScript packages
cd ../..
pnpm install
```

### Production Installation

```bash
cd tensnap/packages/tensnap-python
git pull origin main
pip install --upgrade .
```

## Uninstallation

### Python Package

```bash
pip uninstall tensnap
```

### Complete Removal

```bash
# Remove repository
rm -rf tensnap

# Remove Python package if installed separately
pip uninstall tensnap

# Remove global pnpm cache (optional)
pnpm store prune
```

## Docker Installation (Coming Soon)

Docker support is planned for easier deployment. Watch the repository for updates.

## Troubleshooting

### Issue: `pnpm: command not found`

**Solution**: Install pnpm globally:

```bash
npm install -g pnpm
```

### Issue: Python version mismatch

**Solution**: Use pyenv to manage Python versions:

```bash
pyenv install 3.10
pyenv local 3.10
```

### Issue: Tauri build fails

**Solution**: Ensure all system dependencies are installed. Check the [Tauri documentation](https://tauri.app/v1/guides/getting-started/prerequisites) for platform-specific requirements.

### Issue: Port 8765 already in use

**Solution**: Change the port in your simulation:

```python
server = TenSnapServer(port=8766)  # Use different port
```

Or set environment variable:

```bash
TENSNAP_SERVER_PORT=8766 python your_simulation.py
```

## Next Steps

- **[Getting Started Guide](./getting-started.md)** - Run your first simulation
- **[User Guide](./user-guide.md)** - Learn about all features
- **[Development Setup](../maintainer-guide/development-setup.md)** - Set up for contributing
