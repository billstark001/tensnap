# TenSnap Documentation

Welcome to the TenSnap documentation! TenSnap (short for "NetLogo Snapshot", with "Net" reversed) is an open-source interactive visualization toolkit for agent-based modeling and simulation (ABM&S) that combines NetLogo's immediacy in visualization with the flexibility of modern programming ecosystems.

## Documentation Structure

### For Users

- **[Getting Started](./user-guide/getting-started.md)** - Quick introduction and first steps
- **[Installation Guide](./user-guide/installation.md)** - Detailed installation instructions
- **[User Guide](./user-guide/user-guide.md)** - Comprehensive guide to using TenSnap
- **[Tutorials](./tutorials/)** - Runnable tutorials for Random Walk, Flocking, Predator-Prey, and Network Dynamics, with later chapters still planned
- **[Python API Reference](./api-reference/python-api.md)** - Complete Python API documentation
- **[Go API Reference](./api-reference/go-api.md)** - Go simulator bindings, declarative Scenario API, and incremental diff helpers

### For Maintainers

- **[Architecture Overview](./maintainer-guide/architecture.md)** - System architecture and design
- **[Development Setup](./maintainer-guide/development-setup.md)** - Setting up development environment
- **[Contributing Guidelines](./maintainer-guide/contributing.md)** - How to contribute to TenSnap
- **[Protocol v0.2](./maintainer-guide/protocol-v0.2.md)** - Current WebSocket protocol specification
- **[Internationalization (i18n)](./maintainer-guide/i18n.md)** - Translation and localization guide

## Documentation Status

- The current stable Python surface is documented in [Python API Reference](./api-reference/python-api.md) and `packages/tensnap-python/README.md`.
- The current Go surface is documented in [Go API Reference](./api-reference/go-api.md) and `packages/tensnap-go/README.md`.
- `examples/python/` and `examples/python_mesa/` are the authoritative runnable references.
- `examples/go/` contains the authoritative runnable Go references.
- Tutorial 1, Tutorial 2, Tutorial 3, and Tutorial 4 now map directly to runnable examples; tutorials 5-6 are still planned and do not exist yet.

## What is TenSnap?

TenSnap is a web-based, framework-agnostic visualization tool designed to bridge the gap between NetLogo's interactive visualization capabilities and modern programming languages. Key features include:

- **Interactive Visualization**: Real-time visualization of agent-based simulations with immediate feedback
- **Language Agnostic**: Connect simulations written in any language (Python ready, Java/JavaScript/Go/MATLAB planned)
- **Modern Web Interface**: Built with React for a responsive, feature-rich user experience
- **NetLogo-Inspired UI**: Familiar controls (sliders, buttons, charts) with modern enhancements
- **Multi-Granularity APIs**: From simple high-level APIs for beginners to low-level protocol access for experts
- **Dual Deployment**: Run in browser or as desktop app via Tauri

## Design Philosophy

TenSnap aims to:

1. **Preserve NetLogo's Strengths**: Keep the rapid prototyping and interactive visualization that made NetLogo popular
2. **Embrace Modern Ecosystems**: Allow researchers to use their preferred programming languages and tools
3. **Separate Concerns**: Decouple model logic (any language) from visualization (TenSnap)
4. **Support All Skill Levels**: Provide intuitive APIs for newcomers and powerful tools for experts

## Quick Links

- [GitHub Repository](https://github.com/billstark001/tensnap)
- [Report Issues](https://github.com/billstark001/tensnap/issues)
- [Python Examples](../examples/python/)
- [Mesa Examples](../examples/python_mesa/)
- [Go Examples](../examples/go/)

## Getting Help

- Check the [User Guide](./user-guide/user-guide.md) for common questions
- Look at the [Python examples](../examples/python/), [Mesa examples](../examples/python_mesa/), and [Go examples](../examples/go/) for practical implementations
- Open an issue on [GitHub](https://github.com/billstark001/tensnap/issues) for bugs or feature requests

## License

TenSnap is released under the MIT License. See [LICENSE](../LICENSE) for details.
