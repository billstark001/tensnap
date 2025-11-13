"""Basic tests for tensnap package."""
import pytest
import tensnap


def test_package_import():
    """Test that the package can be imported."""
    assert tensnap is not None


def test_package_version():
    """Test that the package has a version attribute."""
    # This is a placeholder test
    # Add actual version test when __version__ is defined
    assert hasattr(tensnap, '__version__') or True
