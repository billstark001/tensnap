"""Typed Mesa cell-space imports across the 3.x and 4.x API transition."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Iterable, Sequence
    from random import Random

    # Mesa does not publish py.typed. Describe only the cell-grid surface that
    # is shared by its experimental 3.0/3.1 and stable 3.2+/4.0 modules.
    class CellCollection:
        cells: Iterable[Cell]
        agents: Iterable[CellAgent]

    class Cell:
        coordinate: tuple[int, ...]
        agents: list[CellAgent]
        is_empty: bool
        is_full: bool
        neighborhood: CellCollection

        def get_neighborhood(
            self, radius: int = 1, include_center: bool = False
        ) -> CellCollection: ...

    class CellAgent:
        model: Any
        cell: Cell
        unique_id: int

        def __init__(self, model: Any) -> None: ...
        def remove(self) -> None: ...

    class OrthogonalMooreGrid:
        dimensions: Sequence[int]
        all_cells: Iterable[Cell]

        def __init__(
            self,
            dimensions: Sequence[int],
            *,
            torus: bool = False,
            capacity: float | None = None,
            random: Random | None = None,
        ) -> None: ...

        def __getitem__(self, coordinate: tuple[int, ...]) -> Cell: ...
else:
    try:
        from mesa.discrete_space import Cell, CellAgent, OrthogonalMooreGrid
    except ModuleNotFoundError as error:
        if error.name != "mesa.discrete_space":
            raise
        # Mesa 3.0/3.1 published cell space under its experimental namespace.
        from mesa.experimental.cell_space import Cell, CellAgent, OrthogonalMooreGrid

__all__ = ["Cell", "CellAgent", "OrthogonalMooreGrid"]
