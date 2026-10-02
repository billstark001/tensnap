"""Basic tests for tensnap package."""

import tensnap


def test_package_import():
    """Test that the package can be imported."""
    assert tensnap is not None


def test_package_version():
    """The public and wire binding versions come from one source."""
    scenario = tensnap.SimulationScenario(port=8765)
    assert scenario._simulator_info["binding"]["version"] == tensnap.__version__


def test_quick_start_import_path():
    """The published quick-start import path should stay executable."""
    scenario = tensnap.SimulationScenario(port=8765)

    assert isinstance(scenario, tensnap.SimulationScenario)
