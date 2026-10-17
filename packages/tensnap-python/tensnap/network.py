"""IP-family policy for local listeners, independent of protocol messages."""

import errno
import ipaddress
import socket
from typing import Literal

IPFamily = Literal["auto", "ipv4", "ipv6"]


def _listen_targets(host: str, port: int, requested: int) -> list[tuple[int, str]]:
    if not host or host.lower() == "localhost":
        return [
            (socket.AF_INET, "127.0.0.1" if host else "0.0.0.0"),
            (socket.AF_INET6, "::1" if host else "::"),
        ]
    return list(
        dict.fromkeys(
            (family, str(address[0]))
            for family, _, _, _, address in socket.getaddrinfo(
                host, port, requested, socket.SOCK_STREAM
            )
        )
    )


def listen_sockets(
    host: str, port: int, ip_family: IPFamily = "auto"
) -> list[socket.socket]:
    if ip_family not in ("auto", "ipv4", "ipv6"):
        raise ValueError("ip_family must be auto, ipv4, or ipv6")
    host = host.removeprefix("[").removesuffix("]")
    requested = {"auto": 0, "ipv4": socket.AF_INET, "ipv6": socket.AF_INET6}[ip_family]
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if (
        literal is not None
        and requested
        and literal.version != (4 if requested == socket.AF_INET else 6)
    ):
        raise ValueError(f"Address {host} conflicts with ip_family={ip_family}")
    targets = _listen_targets(host, port, requested)
    sockets: list[socket.socket] = []
    try:
        for family, address in targets:
            if requested and family != requested:
                continue
            sock = None
            try:
                sock = socket.socket(family, socket.SOCK_STREAM)
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                if family == socket.AF_INET6:
                    sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
                sock.bind((address, port))
                sock.listen(socket.SOMAXCONN)
                sock.setblocking(False)
                port = sock.getsockname()[1]
                sockets.append(sock)
            except OSError as error:
                if sock is not None:
                    sock.close()
                if (
                    ip_family == "auto"
                    and (not host or host.lower() == "localhost")
                    and error.errno
                    in (errno.EAFNOSUPPORT, errno.EPROTONOSUPPORT, errno.EADDRNOTAVAIL)
                ):
                    continue
                raise
        if not sockets:
            raise OSError("No available IP listen address")
        return sockets
    except BaseException:
        for sock in sockets:
            sock.close()
        raise
