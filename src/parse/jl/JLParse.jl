module JLParse
using ..Scan

include("utils.jl")
include("kinds.jl")
include("exp2.jl")
include("parser.jl")
include("nest.jl")
include("convert.jl")
include("parse/core.jl")
include("parse/clauses.jl")
include("parse/arrays.jl")
include("parse/opers.jl")
include("parse/strings.jl")
include("parse/files.jl")

include("preproc.jl")
preproc()

end
