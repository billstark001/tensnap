# TenSnap Tutorials

Step-by-step tutorials for learning TenSnap.

## Status

- Tutorials 1-4 are now backed by runnable examples in `examples/python/`.
- Tutorials 5-6 are still planned topics only and are not implemented yet.
- For end-to-end reference code, `examples/python/`, `examples/python_mesa/`, and `packages/tensnap-python/README.md` remain the source of truth.

## Tutorial List

### Beginner Tutorials

1. **[Simple Random Walk](./01-random-walk.md)** - Runnable first grid-style simulation
   - Basic agent creation and movement
   - Simple parameter controls
   - Introduction to the UI

2. **[Flocking Behavior](./02-flocking.md)** - Runnable Reynolds' Boids flocking simulation
   - Agent-agent interactions with three behavioral rules
   - Heading and trajectory visualization
   - Measuring emergent properties

### Intermediate Tutorials

3. **[Predator-Prey Dynamics](./03-predator-prey.md)** - Model population dynamics
   - Multiple agent types
   - Agent lifecycle (birth/death)
   - Population tracking with charts
   - Layered field and resource visualization

4. **[Network Dynamics](./04-network-simulation.md)** - Runnable graph-backed opinion dynamics simulation
   - Network/node visualization
   - Directed edges and dynamic rewiring
   - Network metrics and bounded-confidence updates

### Planned Tutorials (Not Yet Implemented)

5. **Custom Protocol Implementation** - Direct protocol access
   - Low-level WebSocket communication
   - Custom message types
   - Performance optimization

6. **Multi-Environment Simulation** - Complex visualizations
   - Multiple simultaneous environments
   - Coordinated updates
   - Cross-environment interactions

## Tutorial Structure

The intended tutorial format is:

- **Learning Objectives**: What you'll learn
- **Prerequisites**: Required knowledge and setup
- **Step-by-Step Instructions**: Detailed walkthrough
- **Complete Code**: Full working example
- **Exercises**: Additional challenges to extend your learning
- **Next Steps**: Where to go from here

## Getting Started

If you're new to TenSnap:

1. Start with [Getting Started Guide](../user-guide/getting-started.md)
2. Follow Tutorial 1: [Simple Random Walk](./01-random-walk.md)
3. Continue with Tutorial 2: [Flocking Behavior](./02-flocking.md)
4. Move on to Tutorial 3: [Predator-Prey Dynamics](./03-predator-prey.md)
5. Continue with Tutorial 4: [Network Dynamics](./04-network-simulation.md)

If you have specific goals:

- **Want to visualize existing simulations?** → Start from Tutorials 1-4, then branch into `examples/python/` or `examples/python_mesa/`
- **Working with networks?** → Start with [Tutorial 4: Network Dynamics](./04-network-simulation.md)
- **Need layered resource fields?** → See `examples/python_mesa/sugarscape_viz.py`
- **Need protocol details?** → Read [Protocol v0.2](../maintainer-guide/protocol-v0.2.md)

## Example Models

The `examples/` directory contains complete, working examples:

**Standard Python Examples** (`examples/python/`):
- **random_walk.py / random_walk_viz.py** - Random walk with charts and parameter controls
- **flock.py / flock_viz.py** - Flocking/boids simulation
- **hk.py / hk_viz.py** - Hegselmann-Krause opinion dynamics
- **predator_prey.py / predator_prey_viz.py** - Predator-prey ecosystem with grass regrowth
- **sirs.py / sirs_viz_*.py** - SIRS epidemic model

**Mesa-Based Examples** (`examples/python_mesa/`):
- **cgol.py / cgol_viz.py** - Conway's Game of Life
- **mushroom.py / mushroom_viz.py** - Mushroom foraging simulation
- **sugarscape.py / sugarscape_viz.py** - Sugarscape resource collection model

These examples demonstrate best practices and can serve as templates for your own models.

## Additional Resources

- **[User Guide](../user-guide/user-guide.md)** - Comprehensive feature documentation
- **[Python API Reference](../api-reference/python-api.md)** - Complete API documentation
- **[GitHub Examples](https://github.com/billstark001/tensnap/tree/main/examples/)** - Browse code online

## Contributing Tutorials

Have an interesting TenSnap use case? Consider contributing a tutorial! See the [Contributing Guidelines](../maintainer-guide/contributing.md) for details.
