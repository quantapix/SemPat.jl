module Metatheory

using RuntimeGeneratedFunctions
using Base.Meta

include("docstrings.jl")

RuntimeGeneratedFunctions.init(@__MODULE__)

# TODO document options
# Options
options = Dict{Symbol, Any}(
    :verbose => false,
    :printiter => false,
)

macro log(args...)
    quote options[:verbose] && @info($(args...)) end |> esc
end

export options



# TODO document this interface
include("expr_abstraction.jl")
export get_funsym
export get_funargs
export set_funsym!
export set_funargs!

include("Util/Util.jl")
using .Util
export Util


include("rgf.jl")
include("rule.jl")
export Rule

include("theory.jl")
include("matchcore_compiler.jl")
include("rewrite.jl")
include("match.jl")


include("EGraphs/EGraphs.jl")
export EGraphs

export @metatheory_init

include("Library/Library.jl")
export Library

export @rule
export @theory

export Theory


export rewrite
export @rewrite
export @esc_rewrite
export @compile_theory
export @matcher
export @rewriter

end # module
