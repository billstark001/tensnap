# Contributing to TenSnap

Thank you for considering contributing to TenSnap! This document provides guidelines and information for contributors.

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [How Can I Contribute?](#how-can-i-contribute)
3. [Development Process](#development-process)
4. [Coding Standards](#coding-standards)
5. [Commit Guidelines](#commit-guidelines)
6. [Pull Request Process](#pull-request-process)
7. [Documentation](#documentation)
8. [Testing](#testing)

## Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inclusive experience for everyone. We expect all contributors to:

- Use welcoming and inclusive language
- Be respectful of differing viewpoints and experiences
- Gracefully accept constructive criticism
- Focus on what is best for the community
- Show empathy towards other community members

### Unacceptable Behavior

- Harassment, discrimination, or trolling
- Publishing others' private information
- Deliberately inflammatory or disruptive behavior
- Other conduct which could reasonably be considered inappropriate

## How Can I Contribute?

### Reporting Bugs

Before submitting a bug report:

1. **Check existing issues**: Search [GitHub Issues](https://github.com/billstark001/tensnap/issues) to see if the bug has been reported
2. **Use the latest version**: Ensure you're using the latest version of TenSnap
3. **Isolate the problem**: Create a minimal reproduction case

When submitting a bug report, include:

- **Clear title**: Descriptive summary of the issue
- **Environment**: OS, Python version, Node version, browser
- **Steps to reproduce**: Detailed steps to reproduce the bug
- **Expected behavior**: What you expected to happen
- **Actual behavior**: What actually happened
- **Code samples**: Minimal reproduction code
- **Screenshots**: If applicable
- **Error messages**: Complete error traces

**Example Bug Report**:

```markdown
### Bug: WebSocket connection fails on macOS

**Environment:**
- OS: macOS 13.0
- Python: 3.10.5
- TenSnap: 0.1.0
- Browser: Chrome 120.0

**Steps to Reproduce:**
1. Run `python flock_viz.py`
2. Open http://localhost:3200
3. Observe connection error in console

**Expected:** WebSocket connects successfully
**Actual:** Connection refused error

**Error Message:**
```

WebSocket connection to 'ws://localhost:8765' failed: Connection refused

```
```

### Suggesting Enhancements

Enhancement suggestions are welcome! Include:

- **Clear use case**: Why is this enhancement needed?
- **Expected behavior**: What should the feature do?
- **Alternative solutions**: Other ways you've considered
- **Impact**: Who benefits from this feature?

### Contributing Code

Areas where contributions are especially welcome:

- **Bug fixes**: Fix reported issues
- **Documentation**: Improve or add documentation
- **Examples**: Add example simulations
- **Language bindings**: parity work and documentation for Python, Go, JavaScript/TypeScript, and Julia; new bindings for additional languages such as Java or MATLAB
- **Performance**: Optimize rendering or communication
- **Testing**: Increase test coverage
- **UI/UX**: Improve interface design

### Contributing Documentation

Documentation contributions are highly valued:

- Fix typos or clarify existing docs
- Add missing documentation
- Create tutorials or guides
- Translate documentation (future)
- Add code examples

### Python Documentation Conventions

When updating Python docs, keep them aligned with the current bindings surface:

- Prefer documenting the current `tensnap.bindings` surface (`env`, `grid_layer`, `agent_layer`, `edge_layer`, `trajectory_layer`, `agent`, `edge`, `chart`, `action`, `BindParametersConfig`) and `SimulationScenario`.
- Legacy compatibility helpers such as `LayeredEnvironmentBinder` can be mentioned when needed, but they should not be presented as the primary API.
- Do not document nonexistent mutable runtime classes such as `AgentModel`, `GridEnvironmentModel`, or `GraphEnvironmentModel`.
- Default control semantics are renderer-driven: `start`, `step`, and `reset` are the canonical built-ins; `stop` is only present when a scenario registers an explicit backend action.
- Low-level server examples should use `update_layer_metadata()`, `update_layer_agents()`, `update_layer_edges()`, `replace_layer_state()`, and `replace_environment_layers()` rather than removed layer-less update helpers.

### JavaScript and Julia Documentation Conventions

- JavaScript simulator docs should describe `@tensnap/js` as a workspace-private TypeScript package unless its package metadata changes.
- Prefer `defineModel(...)`, `defineExample(...)`, `SimulatorSession`, `SimulatorEmitter`, and the postMessage/WebSocket hosts when documenting JavaScript bindings.
- Julia docs should describe `TenSnap.jl` as a native Julia package under `packages/tensnap-julia`, not as an npm-scoped package.
- Prefer explicit Julia builders such as `Scenario`, `parameter(...)`, `agents_layer(...)`, `chart(...)`, `publish_asset!`, and `request_screenshot!`.

## Development Process

### 1. Set Up Development Environment

Follow the [Development Setup Guide](./development-setup.md) to configure your environment.

### 2. Find or Create an Issue

- Browse [open issues](https://github.com/billstark001/tensnap/issues)
- Comment on issues you'd like to work on
- For new features, create an issue first to discuss

### 3. Fork and Branch

```bash
# Fork the repository on GitHub, then:
git clone https://github.com/YOUR_USERNAME/tensnap.git
cd tensnap
git remote add upstream https://github.com/billstark001/tensnap.git

# Create a feature branch
git checkout -b feature/your-feature-name
```

### 4. Make Changes

- Write code following [coding standards](#coding-standards)
- Add tests for new functionality
- Update documentation as needed
- Keep changes focused and atomic

### 5. Test Your Changes

```bash
# Python tests
cd packages/tensnap-python
pytest
cd ../..

# JavaScript tests
pnpm test

# Go tests
cd packages/tensnap-go
go test ./...
cd ../..

# Julia tests
pnpm run test:julia

# Lint checks
pnpm lint
```

### 6. Commit Changes

Follow [commit guidelines](#commit-guidelines):

```bash
git add .
git commit -m "feat: add new parameter binding feature"
```

### 7. Push and Create PR

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub.

## Coding Standards

### Python Code Style

TenSnap follows PEP 8 with some modifications:

- **Formatter**: Black (line length: 88)
- **Linter**: Ruff
- **Type hints**: Required for public APIs
- **Docstrings**: Google style

**Example**:

```python
from dataclasses import dataclass


@dataclass
class SimulationConfig:
  """Configuration for a renderer-driven TenSnap scenario.

  Args:
    population: Number of agents to initialize.
    step_size: Movement amount per simulation step.
    debug_mode: Whether to expose extra runtime diagnostics.
  """

  population: int = 100
  step_size: float = 1.0
  debug_mode: bool = False

  def scaled_step_size(self, scale: float) -> float:
    """Return a scaled step size without mutating the config."""
    return self.step_size * scale
```

**Running Code Formatters**:

```bash
cd packages/tensnap-python

# Format code
black tensnap/

# Lint
ruff check tensnap/

# Type check
mypy tensnap/
```

### TypeScript/React Code Style

- **Formatter**: Prettier (integrated with ESLint)
- **Linter**: ESLint
- **Style Guide**: Airbnb React/TypeScript
- **Component Style**: Functional components with hooks

**Example**:

```typescript
import React, { useState, useCallback } from 'react';

interface ParameterSliderProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

/**
 * Slider component for numeric parameters
 */
export const ParameterSlider: React.FC<ParameterSliderProps> = ({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
}) => {
  const [localValue, setLocalValue] = useState(value);
  
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value);
    setLocalValue(newValue);
    onChange(newValue);
  }, [onChange]);
  
  return (
    <div className="parameter-slider">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={localValue}
        onChange={handleChange}
      />
      <span>{localValue.toFixed(2)}</span>
    </div>
  );
};
```

**Running Linter**:

```bash
cd packages/tensnap-web
pnpm lint
pnpm lint --fix  # Auto-fix issues
```

### General Guidelines

- **Keep it simple**: Prefer simple, readable code over clever code
- **DRY principle**: Don't repeat yourself
- **Single responsibility**: Each function/class should do one thing
- **Naming conventions**:
  - Python: `snake_case` for functions/variables, `PascalCase` for classes
  - TypeScript: `camelCase` for functions/variables, `PascalCase` for classes/interfaces
- **Comments**: Explain *why*, not *what*
- **Error handling**: Handle errors gracefully with informative messages

## Commit Guidelines

### Commit Message Format

TenSnap uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type** (required):

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Scope** (optional): Component affected (e.g., `python`, `web`, `tauri`, `docs`)

**Subject** (required): Brief description in imperative mood

**Examples**:

```
feat(python): add graph environment support

docs: update installation guide with Tauri instructions

fix(web): resolve WebSocket reconnection issue

test(python): add tests for parameter binding

refactor(web): extract chart component logic
```

### Good Commit Practices

- **Atomic commits**: Each commit should be a logical unit
- **Descriptive messages**: Explain what and why, not how
- **Reference issues**: Mention issue numbers (`fixes #123`, `closes #456`)
- **Small commits**: Prefer multiple small commits over one large commit

## Pull Request Process

### Before Submitting

- [ ] Code follows style guidelines
- [ ] All tests pass
- [ ] New tests added for new features
- [ ] Documentation updated
- [ ] Commit messages follow convention
- [ ] No merge conflicts with main branch

### PR Title and Description

**Title**: Use conventional commit format

**Description Template**:

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
Describe tests performed

## Related Issues
Closes #123
Related to #456

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated
- [ ] Tests added/updated
- [ ] All tests pass
```

### Review Process

1. **Automatic checks**: CI runs tests and linting
2. **Code review**: Maintainer reviews code
3. **Requested changes**: Address feedback
4. **Approval**: Maintainer approves PR
5. **Merge**: Maintainer merges to main

### After PR is Merged

- Delete your feature branch
- Pull latest main branch
- Continue with next contribution!

## Documentation

### Documentation Structure

- **User Documentation**: `/docs/user-guide/`
- **API Reference**: `/docs/api-reference/`
- **Tutorials**: `/docs/tutorials/`
- **Maintainer Documentation**: `/docs/maintainer-guide/`

### Writing Documentation

- **Clear and concise**: Use simple language
- **Code examples**: Include working examples
- **Structure**: Use headings, lists, and formatting
- **Cross-references**: Link to related documentation
- **Keep updated**: Update docs when changing code

### Docstring Format (Python)

Use Google-style docstrings:

```python
def calculate_distance(x1: float, y1: float, x2: float, y2: float) -> float:
    """Calculate Euclidean distance between two points.
    
    Args:
        x1: X coordinate of first point
        y1: Y coordinate of first point
        x2: X coordinate of second point
        y2: Y coordinate of second point
    
    Returns:
        Distance between the two points
    
    Examples:
        >>> calculate_distance(0, 0, 3, 4)
        5.0
    """
    dx = x2 - x1
    dy = y2 - y1
    return math.sqrt(dx * dx + dy * dy)
```

## Testing

### Python Testing

Use pytest for Python tests:

```python
# tests/test_environment.py
import pytest
from tensnap import SimulationScenario, agent, agent_layer, env, grid_layer


@agent(x=True, y=True)
class Bird:
  def __init__(self, bird_id: str, x: int, y: int) -> None:
    self.id = bird_id
    self.x = x
    self.y = y


@grid_layer(width="width", height="height")
@agent_layer("agents", item_iterable_projector="agents")
@env(id="test")
class GridEnv:
  def __init__(self) -> None:
    self.width = 50
    self.height = 50
    self.agents = [Bird("a1", 25, 25)]


@pytest.mark.asyncio
async def test_server_broadcast():
  """Test async server functionality."""
  # Test async code here
  pass


@pytest.fixture
def sample_environment():
  """Fixture for a decorator-backed environment."""
  return GridEnv()


def test_environment_with_fixture(sample_environment):
  """Test using fixture."""
  scenario = SimulationScenario()
  scenario.add_all(sample_environment)
  registration = scenario.environments["main"]
  state = registration.build_state()
  grid = next(layer for layer in state["layers"] if layer["layer_id"] == "grid")
  assert grid["data"]["width"] == 50
```

### JavaScript Testing

Use Vitest and React Testing Library:

```typescript
// src/components/ParameterSlider.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ParameterSlider } from './ParameterSlider';

describe('ParameterSlider', () => {
  const mockOnChange = vi.fn();
  
  it('renders with correct label', () => {
    render(
      <ParameterSlider
        id="test"
        label="Test Parameter"
        value={50}
        min={0}
        max={100}
        step={1}
        onChange={mockOnChange}
      />
    );
    
    expect(screen.getByText('Test Parameter')).toBeInTheDocument();
  });
  
  it('calls onChange when value changes', () => {
    render(
      <ParameterSlider
        id="test"
        label="Test"
        value={50}
        min={0}
        max={100}
        step={1}
        onChange={mockOnChange}
      />
    );
    
    const slider = screen.getByRole('number');
    fireEvent.change(slider, { target: { value: '75' } });
    
    expect(mockOnChange).toHaveBeenCalledWith(75);
  });
});
```

### Test Coverage

Aim for:

- **Line coverage**: >80%
- **Branch coverage**: >70%
- **Function coverage**: >80%

Check coverage:

```bash
# Python
pytest --cov=tensnap --cov-report=html

# JavaScript
pnpm test -- --coverage
```

## Recognition

Contributors are recognized in:

- Git commit history
- GitHub contributors page
- Release notes (for significant contributions)

## Questions?

- **General questions**: Open a GitHub Discussion
- **Specific issues**: Comment on related issue
- **Contribution questions**: Open an issue with "question" label

## License

By contributing to TenSnap, you agree that your contributions will be licensed under the MIT License.

## Thank You

Your contributions make TenSnap better for everyone. Thank you for taking the time to contribute!
