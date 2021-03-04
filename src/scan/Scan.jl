module Scan

include("utils.jl")
include("kinds.jl")
include("token.jl")
include("scanner.jl")

include("preproc.jl")
preproc()

export is_eof, is_kw, is_lit, is_op, is_ws
export peek_one, read_one, read_ws, scan, unscan
export RawTok, Scanner

end
