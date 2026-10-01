# Model state inverses for TenSnap restoration.
using Serialization

function capture_bar(model::ElFarolModel)
    io = IOBuffer()
    serialize(io, (agents=deepcopy(model.agents), capacity=model.capacity,
        attendance=model.attendance, history=copy(model.history), rng=deepcopy(model.rng)))
    return take!(io)
end

function restore_bar!(data, model::ElFarolModel)
    state = deserialize(IOBuffer(data))
    model.agents = state.agents
    model.capacity = state.capacity
    model.attendance = state.attendance
    model.history = state.history
    model.rng = state.rng
    return nothing
end

function restore_patrons!(items, model::ElFarolModel)
    length(items) == length(model.agents) || error("El Farol restore requires every patron")
    ids = Set{Int}()
    patrons = Patron[]
    for item in items
        id = Int(item["id"])
        id in ids && error("duplicate patron id: $(id)")
        push!(ids, id)
        data = item["data"]
        attending = data["attending"]
        attending isa Bool || error("patron attending must be boolean")
        push!(patrons, Patron(id, attending, Float64(data["expected"]), Float64(data["score"])))
    end
    sort!(patrons; by=p -> p.id)
    model.agents = patrons
    model.attendance = count(p -> p.attending, patrons)
    model.history = [model.attendance]
    return nothing
end
