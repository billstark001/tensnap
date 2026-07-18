# Thin user CLI over study code shared with the benchmark kernel. This split is
# for repository reuse, not required structure for an Agents.jl model.
include("schelling.jl")
include("schelling_study.jl")

write_schelling_study_csv(run_schelling_study(parse_schelling_study_options()))
