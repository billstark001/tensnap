# TenSnap Tutorials

Step-by-step tutorials to help you learn TenSnap by building real simulations.

## Tutorial List

### Beginner Tutorials

1. **[Simple Random Walk](./01-random-walk.md)** - Create your first agent-based simulation
   - Basic agent creation and movement
   - Simple parameter controls
   - Introduction to the UI

2. **[Flocking Behavior](./02-flocking.md)** - Implement Reynolds' Boids flocking simulation
   - Agent-agent interactions with three behavioral rules
   - Heading and trajectory visualization
   - Measuring emergent properties

### Intermediate Tutorials

3. **[Predator-Prey Dynamics](./03-predator-prey.md)** - Model population dynamics
   - Multiple agent types
   - Agent lifecycle (birth/death)
   - Population tracking with charts
   - Background visualization

4. **[Network Dynamics](./04-network-simulation.md)** - Work with graph environments
   - Graph/network visualization
   - Agents on networks
   - Network metrics

### Advanced Tutorials

5. **[Custom Protocol Implementation](./05-custom-protocol.md)** - Direct protocol access
   - Low-level WebSocket communication
   - Custom message types
   - Performance optimization

6. **[Multi-Environment Simulation](./06-multi-environment.md)** - Complex visualizations
   - Multiple simultaneous environments
   - Coordinated updates
   - Cross-environment interactions

## Tutorial Structure

Each tutorial includes:

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
3. Continue through the tutorials in order

If you have specific goals:

- **Want to visualize existing simulations?** → Tutorial 2 or 3
- **Working with networks?** → Tutorial 4
- **Need high performance?** → Tutorial 5
- **Complex multi-view setups?** → Tutorial 6

## Example Models

The `packages/tensnap-python/tensnap/examples/` directory contains complete, working examples:

- **flock.py / flock_viz.py** - Flocking/boids simulation
- **hk.py / hk_viz.py** - Hegselmann-Krause opinion dynamics
- **mushroom.py / mushroom_viz.py** - Mushroom fairy ring growth
- **sugarscape.py** - Sugarscape resource collection model

These examples demonstrate best practices and can serve as templates for your own models.

## Additional Resources

- **[User Guide](../user-guide/user-guide.md)** - Comprehensive feature documentation
- **[Python API Reference](../api-reference/python-api.md)** - Complete API documentation
- **[GitHub Examples](https://github.com/billstark001/tensnap/tree/main/packages/tensnap-python/tensnap/examples)** - Browse code online

## Contributing Tutorials

Have an interesting TenSnap use case? Consider contributing a tutorial! See the [Contributing Guidelines](../maintainer-guide/contributing.md) for details.
