"""Publication adapter over the example's reusable TenSnap server."""

import asyncio
import os

from config import model_kwargs_from_environment
import model  # noqa: F401  # Ensures the example modules are importable.
from schelling_tensnap import run_schelling_server


if __name__ == "__main__":
    asyncio.run(run_schelling_server(
        model_kwargs=model_kwargs_from_environment(),
        server_port=int(os.environ.get("TENSNAP_SERVER_PORT", "8765")),
    ))
