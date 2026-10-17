import asyncio
import errno
import socket

import pytest
from websockets.asyncio.client import connect

from tensnap.network import listen_sockets
from tensnap.server import TenSnapServer


def ipv6_available():
    try:
        sockets = listen_sockets("localhost", 0, "ipv6")
    except OSError as error:
        if error.errno in (
            errno.EAFNOSUPPORT,
            errno.EPROTONOSUPPORT,
            errno.EADDRNOTAVAIL,
        ):
            return False
        raise
    for sock in sockets:
        sock.close()
    return True


@pytest.mark.parametrize(
    "family,expected", [("ipv4", socket.AF_INET), ("ipv6", socket.AF_INET6)]
)
def test_forced_family(family, expected):
    if family == "ipv6" and not ipv6_available():
        pytest.skip("IPv6 unavailable")
    sockets = listen_sockets("localhost", 0, family)
    try:
        assert [sock.family for sock in sockets] == [expected]
    finally:
        for sock in sockets:
            sock.close()


def test_auto_shares_port_zero_and_rolls_back_conflict():
    if not ipv6_available():
        pytest.skip("IPv6 unavailable")
    sockets = listen_sockets("localhost", 0)
    try:
        assert {sock.family for sock in sockets} == {socket.AF_INET, socket.AF_INET6}
        assert len({sock.getsockname()[1] for sock in sockets}) == 1
    finally:
        for sock in sockets:
            sock.close()
    blocker = listen_sockets("localhost", 0, "ipv6")
    port = blocker[0].getsockname()[1]
    try:
        with pytest.raises(OSError) as error:
            listen_sockets("localhost", port)
        assert error.value.errno == errno.EADDRINUSE
        replacement = listen_sockets("localhost", port, "ipv4")
        for sock in replacement:
            sock.close()
    finally:
        for sock in blocker:
            sock.close()


def test_invalid_policy_and_conflicting_literal():
    with pytest.raises(ValueError, match="ip_family"):
        listen_sockets("localhost", 0, "other")
    with pytest.raises(ValueError, match="conflicts"):
        listen_sockets("127.0.0.1", 0, "ipv6")
    with pytest.raises(ValueError, match="conflicts"):
        listen_sockets("::1", 0, "ipv4")


@pytest.mark.asyncio
async def test_both_websocket_endpoints_share_server_and_shutdown():
    server = TenSnapServer(port=0)
    task = asyncio.create_task(server.run())
    try:

        async def check_endpoints():
            while not server.listening_addresses:
                if task.done():
                    await task
                await asyncio.sleep(0.01)
            for address in server.listening_addresses:
                host = f"[{address[0]}]" if ":" in address[0] else address[0]
                async with connect(f"ws://{host}:{server.port}"):
                    pass

        await asyncio.wait_for(check_endpoints(), 3)
    finally:
        server.stop()
        await asyncio.wait_for(task, 3)
    assert server.listening_addresses == []
