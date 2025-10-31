# TenSnap Documentation

Welcome to the TenSnap documentation! TenSnap (short for "NetLogo Snapshot", with "Net" reversed) is an open-source interactive visualization toolkit for agent-based modeling and simulation (ABM&S) that combines NetLogo's immediacy in visualization with the flexibility of modern programming ecosystems.

## Documentation Structure

### For Users

- **[Getting Started](./user-guide/getting-started.md)** - Quick introduction and first steps
- **[Installation Guide](./user-guide/installation.md)** - Detailed installation instructions
- **[User Guide](./user-guide/user-guide.md)** - Comprehensive guide to using TenSnap
- **[Tutorials](./tutorials/)** - Step-by-step tutorials and examples
- **[Python API Reference](./api-reference/python-api.md)** - Complete Python API documentation

### For Maintainers

- **[Architecture Overview](./maintainer-guide/architecture.md)** - System architecture and design
- **[Development Setup](./maintainer-guide/development-setup.md)** - Setting up development environment
- **[Contributing Guidelines](./maintainer-guide/contributing.md)** - How to contribute to TenSnap
- **[Protocol Documentation](./maintainer-guide/protocol.md)** - WebSocket protocol specification

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
- [Example Models](../packages/tensnap-python/tensnap/examples/)

## Getting Help

- Check the [User Guide](./user-guide/user-guide.md) for common questions
- Look at the [Examples](../packages/tensnap-python/tensnap/examples/) for practical implementations
- Open an issue on [GitHub](https://github.com/billstark001/tensnap/issues) for bugs or feature requests

## License

TenSnap is released under the MIT License. See [LICENSE](../LICENSE) for details.
