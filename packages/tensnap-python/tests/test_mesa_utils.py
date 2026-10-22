"""Shared Mesa compatibility must preserve native types and optional imports."""

import importlib
import subprocess
import sys

import mesa
import pytest

import tensnap
from tensnap.bindings import mesa as mesa_bindings
from tensnap.bindings.mesa import clock, utils


def test_legacy_step_cleanup_preserves_agent_id_allocation():
    model = mesa.Model(rng=7)
    first_id = mesa.Agent(model).unique_id
    utils.cleanup_mesa_model_step(model)
    assert mesa.Agent(model).unique_id == first_id + 1


def test_legacy_clock_imports_remain_identical_to_utils():
    for name in (
        "mesa_model_time",
        "validate_mesa_model_time_restore",
        "restore_mesa_model_time",
    ):
        assert getattr(tensnap, name) is getattr(utils, name)
        assert getattr(mesa_bindings, name) is getattr(utils, name)
        assert getattr(clock, name) is getattr(utils, name)
    assert clock.mesa_clock_restore.apply is utils.restore_mesa_model_time
    assert clock.mesa_clock_restore.validate is utils.validate_mesa_model_time_restore


def test_cell_space_exports_are_native_mesa_classes():
    namespace = (
        "mesa.experimental.cell_space"
        if mesa.__version__.startswith(("3.0.", "3.1."))
        else "mesa.discrete_space"
    )
    native = importlib.import_module(namespace)
    assert utils.Cell is native.Cell
    assert utils.CellAgent is native.CellAgent
    assert utils.CellCollection is native.CellCollection
    assert utils.OrthogonalMooreGrid is native.OrthogonalMooreGrid


@pytest.mark.parametrize(
    "error",
    [
        ModuleNotFoundError("missing dependency", name="numpy"),
        ImportError("broken Mesa extension"),
    ],
)
def test_cell_space_fallback_does_not_hide_broken_dependencies(monkeypatch, error):
    calls = []

    def broken_import(name):
        calls.append(name)
        raise error

    utils._load_mesa_cell_space.cache_clear()
    try:
        with monkeypatch.context() as patch:
            patch.setattr(utils.importlib, "import_module", broken_import)
            with pytest.raises(type(error)) as raised:
                utils._load_mesa_cell_space()
            assert raised.value is error
            assert calls == ["mesa.discrete_space"]
    finally:
        utils._load_mesa_cell_space.cache_clear()


def test_tensnap_and_clock_binding_import_without_optional_mesa():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            """
import importlib.abc
import sys

class BlockMesa(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == 'mesa' or fullname.startswith('mesa.'):
            raise ModuleNotFoundError('Mesa is not installed', name='mesa')

sys.meta_path.insert(0, BlockMesa())
import tensnap
from tensnap.bindings.mesa import mesa_clock_restore, prepare_mesa_model_reinit
assert 'mesa' not in sys.modules
try:
    from tensnap.bindings.mesa.utils import Cell
except ModuleNotFoundError as error:
    assert error.name == 'mesa'
else:
    raise AssertionError('Cell-space exports must require Mesa when requested')
""",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
