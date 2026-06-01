mutable struct ToyAgent
	id::Int
	x::Float64
	y::Float64
end

mutable struct ToyModel
	agents::Vector{ToyAgent}
	threshold::Int
	ticks::Int
end
