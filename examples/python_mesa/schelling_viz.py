"""Thin teaching launcher over the reusable TenSnap binding/server.

The split is for reuse with the benchmark server adapter; it is not required
for an ordinary Mesa-to-TenSnap example.
"""

import import_config

import asyncio
import argparse

from schelling_tensnap import run_schelling_server


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--width", type=int, default=50)
    parser.add_argument("--height", type=int, default=50)
    parser.add_argument("--density", type=float, default=0.8)
    parser.add_argument("--balance", type=float, default=0.5)
    parser.add_argument("--threshold", type=float, default=0.7)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--encoding", choices=("json", "msgpack"), default="json")
    parser.add_argument("--no-collect-data", action="store_true")
    args = parser.parse_args()
    asyncio.run(run_schelling_server(
        model_kwargs={"width": args.width, "height": args.height,
                      "density": args.density, "balance": args.balance,
                      "similarity_threshold": args.threshold, "rng": args.seed,
                      "collect_data": not args.no_collect_data},
        server_port=args.port, use_msgpack=args.encoding == "msgpack"))
