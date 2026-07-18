"""Thin teaching launcher over the reusable TenSnap binding/server.

The split is for reuse with the benchmark server adapter; it is not required
for an ordinary Mesa-to-TenSnap example.
"""

import import_config

import asyncio

from schelling_tensnap import run_schelling_server


if __name__ == "__main__":
    asyncio.run(run_schelling_server())
