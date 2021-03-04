module Match
using Random
using ..Utils

export @active, @as_record, @capture, @cond, @data, @destructure, @λ, @like, @match, @matchast, @mate, @otherwise, @switch, @when
export Do, Many, longdef, shortdef, join_def, split_def, splitarg, join_struct, split_struct
export SyntaxError

include("base.jl")

include("utils/expr.jl")
include("utils/chain.jl")

include("pack.jl")
include("parse.jl")
include("build.jl")

include("core.jl")
include("utils/expr2.jl")
include("parse2.jl")
include("core2.jl")

include("parts.jl")
include("quick.jl")

const animals = Symbol[]
const animals_file = joinpath(@__DIR__, "..", "animals.txt")

_animals = split(read(animals_file, String))
resize!(animals, length(_animals))
animals .= Symbol.(lowercase.(_animals))

__init__() = Random.shuffle!(animals)

end
