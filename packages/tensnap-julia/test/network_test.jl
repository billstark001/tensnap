@testset "IP-family listener policy" begin
  @test_throws ErrorException Scenario(ip_family = "other")
  @test_throws ErrorException TenSnap._listen_sockets("127.0.0.1", 0, "ipv6")
  @test_throws ErrorException TenSnap._listen_sockets("::1", 0, "ipv4")
  for (family, expected) in
      (("ipv4", TenSnap.IPv4), ("ipv6", TenSnap.IPv6), ("auto", nothing))
    listeners = try
      TenSnap._listen_sockets("localhost", 0, family)
    catch cause
      if family == "ipv6" &&
         cause isa Base.IOError &&
         cause.code in
         (Base.UV_EAFNOSUPPORT, Base.UV_EPROTONOSUPPORT, Base.UV_EADDRNOTAVAIL)
        @test_skip "IPv6 unavailable"
        continue
      end
      rethrow()
    end
    try
      addresses = TenSnap.getsockname.(listeners)
      @test length(unique(last.(addresses))) == 1
      if expected !== nothing
        @test length(listeners) == 1
        @test first(addresses)[1] isa expected
      end
      for listener in listeners
        host, port = TenSnap.getsockname(listener)
        connection = TenSnap.Sockets.connect(host, port)
        accepted = TenSnap.Sockets.accept(listener)
        close(connection)
        close(accepted)
      end
    finally
      foreach(close, listeners)
    end
  end
end

@testset "Dual listener WebSocket identity" begin
  scenario = Scenario(host = "localhost", port = 0, model_id = "network-fixture")
  listeners = TenSnap._listen_sockets(scenario.host, scenario.port)
  servers = TenSnap.HTTP.Servers.Server[]
  try
    for listener in listeners
      push!(
        servers,
        TenSnap.HTTP.WebSockets.listen!(
          ws -> TenSnap._serve_client(scenario, ws),
          listener,
        ),
      )
    end
    for listener in listeners
      host, port = TenSnap.getsockname(listener)
      authority = host isa TenSnap.IPv6 ? "[$host]" : string(host)
      TenSnap.HTTP.WebSockets.open("ws://$authority:$port") do ws
        message = TenSnap.JSON3.read(String(TenSnap.HTTP.WebSockets.receive(ws)))
        @test message.type == "simulator_info"
        @test message.payload.model.id == "network-fixture"
      end
    end
  finally
    foreach(close, servers)
    foreach(close, listeners)
  end
  @test isempty(scenario.clients)
end

@testset "Dual listener conflict rolls back" begin
  blocker = TenSnap._listen_sockets("localhost", 0, "ipv4")
  # Reverse conflict direction: preserve the existing IPv4 service on failure.
  port = Int(TenSnap.getsockname(blocker[1])[2])
  try
    @test_throws Exception TenSnap._listen_sockets("localhost", port)
  finally
    foreach(close, blocker)
  end
  replacement = TenSnap._listen_sockets("localhost", port)
  foreach(close, replacement)
end

@testset "Failed handshake releases client bookkeeping" begin
  scenario = Scenario()
  listener = only(TenSnap._listen_sockets("127.0.0.1", 0, "ipv4"))
  completed = Channel{Bool}(1)
  server = TenSnap.HTTP.WebSockets.listen!(listener) do ws
    close(ws)
    scenario.client_encodings[ws] = true
    failed = false
    try
      TenSnap._serve_client(scenario, ws)
    catch
      failed = true
    end
    put!(
      completed,
      failed && isempty(scenario.clients) && isempty(scenario.client_encodings),
    )
  end
  try
    host, port = TenSnap.getsockname(listener)
    TenSnap.HTTP.WebSockets.open("ws://$host:$port") do ws
      close(ws)
    end
    @test timedwait(() -> isready(completed), 5) == :ok
    isready(completed) && @test take!(completed)
  finally
    close(server)
    close(listener)
  end
end
