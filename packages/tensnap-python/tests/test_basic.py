"""Basic tests for tensnap package."""

import tensnap


def test_package_import():
    """Test that the package can be imported."""
    assert tensnap is not None


def test_package_version():
    """Test that the package exports the expected version string."""
    assert tensnap.__version__ == "0.2.2"


def test_quick_start_import_path():
    """The published quick-start import path should stay executable."""
    scenario = tensnap.SimulationScenario(port=8765)

    assert isinstance(scenario, tensnap.SimulationScenario)
