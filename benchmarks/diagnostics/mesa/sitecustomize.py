"""Install diagnostic probes only for an explicitly configured child server."""

import os


def install_probes():
    import atexit
    import gc
    import hashlib
    import importlib.util
    import json
    import platform
    import resource
    import signal
    import sys
    import time
    from contextvars import ContextVar
    from functools import wraps
    from pathlib import Path

    from mesa.datacollection import DataCollector
    from tensnap.handler import DefaultSimulationHandler
    from tensnap.scenario import SimulationScenario
    from tensnap.server import TenSnapServer
    from tensnap.utils.ws import BatchedMessageQueue

    output = Path(os.environ["TENSNAP_TIMEOUT_SERVER_TRACE"])
    model_path = Path(os.environ["TENSNAP_TIMEOUT_MODEL_SOURCE"])
    sys.path.insert(
        0, str(Path(__file__).resolve().parents[3] / "examples/python_mesa")
    )
    spec = importlib.util.spec_from_file_location("schelling", model_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["schelling"] = module
    spec.loader.exec_module(module)
    rows = []
    active = ContextVar("timeout_diagnostic_action", default=None)
    clock = lambda: time.perf_counter_ns() / 1e6
    cpu_clock = lambda: time.thread_time_ns() / 1e6
    metadata = {
        "schemaVersion": 2,
        "python": sys.version,
        "platform": platform.platform(),
        "pid": os.getpid(),
        "clock": "perf_counter_ms",
        "modelSha256": hashlib.sha256(model_path.read_bytes()).hexdigest(),
    }

    def write_trace(status):
        output.write_text(
            json.dumps({**metadata, "status": status, "actions": rows}),
            encoding="utf-8",
        )

    def probe(cls, name, label, asynchronous=False):
        original = getattr(cls, name)
        if asynchronous:

            @wraps(original)
            async def measured(*args, **kwargs):
                row = active.get()
                started, cpu_started = clock(), cpu_clock()
                try:
                    return await original(*args, **kwargs)
                finally:
                    if row is not None:
                        row.setdefault(label, []).append([started, clock()])
                        row.setdefault(label + "Cpu", []).append(
                            [cpu_started, cpu_clock()]
                        )
        else:

            @wraps(original)
            def measured(*args, **kwargs):
                row = active.get()
                started, cpu_started = clock(), cpu_clock()
                try:
                    return original(*args, **kwargs)
                finally:
                    if row is not None:
                        row.setdefault(label, []).append([started, clock()])
                        row.setdefault(label + "Cpu", []).append(
                            [cpu_started, cpu_clock()]
                        )

        setattr(cls, name, measured)

    original_action = SimulationScenario._on_action_invoke

    @wraps(original_action)
    async def action(self, ws, payload):
        row = {
            "requestId": payload.get("request_id"),
            "receivedMs": clock(),
            "receivedCpuMs": cpu_clock(),
        }
        usage_before = resource.getrusage(resource.RUSAGE_SELF)
        rows.append(row)
        token = active.set(row)
        try:
            return await original_action(self, ws, payload)
        finally:
            row["finishedMs"], row["finishedCpuMs"] = clock(), cpu_clock()
            usage_after = resource.getrusage(resource.RUSAGE_SELF)
            row["resources"] = {
                name: getattr(usage_after, name) - getattr(usage_before, name)
                for name in (
                    "ru_majflt",
                    "ru_minflt",
                    "ru_nswap",
                    "ru_inblock",
                    "ru_oublock",
                    "ru_nvcsw",
                    "ru_nivcsw",
                )
            }
            active.reset(token)

    SimulationScenario._on_action_invoke = action
    probe(module.SchellingModel, "step", "model")
    probe(DataCollector, "collect", "collection")
    probe(DefaultSimulationHandler, "_push_env_updates", "projection", True)
    probe(SimulationScenario, "broadcast_charts", "charts", True)
    probe(BatchedMessageQueue, "flush", "flush", True)
    probe(TenSnapServer, "send_action_result", "result", True)
    probe(TenSnapServer, "send", "send", True)
    gc_started = None

    def gc_probe(phase, info):
        nonlocal gc_started
        if phase == "start":
            gc_started = clock(), cpu_clock()
        elif active.get() is not None and gc_started is not None:
            active.get().setdefault("gc", []).append(
                {
                    "startMs": gc_started[0],
                    "durationMs": clock() - gc_started[0],
                    "cpuMs": cpu_clock() - gc_started[1],
                    **info,
                }
            )

    gc.callbacks.append(gc_probe)

    def finish():
        if gc_probe in gc.callbacks:
            gc.callbacks.remove(gc_probe)
        write_trace("stopped")

    def terminate(signum, frame):
        try:
            finish()
        finally:
            signal.signal(signum, signal.SIG_DFL)
            os.kill(os.getpid(), signum)

    signal.signal(signal.SIGTERM, terminate)
    atexit.register(finish)
    write_trace("ready")  # Startup handshake; no writes during the measured run.


if os.environ.get("TENSNAP_TIMEOUT_SERVER_TRACE"):
    install_probes()
