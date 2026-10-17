function _listen_sockets(host::String, port::Int, ip_family::String = "auto")
  ip_family in ("auto", "ipv4", "ipv6") || error("ip_family must be auto, ipv4, or ipv6")
  host = replace(host, r"^\[|\]$" => "")
  local_host = isempty(host) || lowercase(host) == "localhost"
  literal = try
    parse(IPAddr, host)
  catch cause
    cause isa ArgumentError || rethrow()
    nothing
  end
  if literal !== nothing && (
    (ip_family == "ipv4" && literal isa IPv6) || (ip_family == "ipv6" && literal isa IPv4)
  )
    error("Address $host conflicts with ip_family=$ip_family")
  end
  addresses = if local_host
    isempty(host) ? IPAddr[ip"0.0.0.0", ip"::"] : IPAddr[ip"127.0.0.1", ip"::1"]
  elseif literal !== nothing
    IPAddr[literal]
  else
    getalladdrinfo(host)
  end
  listeners = TCPServer[]
  try
    for address in unique(addresses)
      ip_family == "ipv4" && address isa IPv6 && continue
      ip_family == "ipv6" && address isa IPv4 && continue
      listener = TCPServer()
      try
        bind(listener, address, port; ipv6only = address isa IPv6) ||
          error("Cannot bind $address:$port")
        Sockets.listen(listener)
        port = Int(getsockname(listener)[2])
        push!(listeners, listener)
      catch cause
        close(listener)
        if ip_family == "auto" &&
           local_host &&
           cause isa Base.IOError &&
           cause.code in
           (Base.UV_EAFNOSUPPORT, Base.UV_EPROTONOSUPPORT, Base.UV_EADDRNOTAVAIL)
          continue
        end
        rethrow()
      end
    end
    isempty(listeners) && error("No available $ip_family listen address for $host")
    return listeners
  catch
    foreach(close, listeners)
    rethrow()
  end
end
