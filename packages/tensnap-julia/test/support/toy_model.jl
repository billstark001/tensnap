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

mutable struct ToyConfig
	speed::Float64
	enabled::Bool
	label::String
	agents::Vector{ToyAgent}
end

mutable struct ToyWrapper
	config::ToyConfig
end
