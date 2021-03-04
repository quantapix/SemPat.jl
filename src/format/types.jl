struct Opts
    indent::Int
    indents::Bool
    ops::Bool
    tuples::Bool
    curly::Bool
    calls::Bool
    iters::Bool
    comments::Bool
    docs::Bool
    lineends::Bool
    kws::Bool
    kwarg::String
end

const default_opts = (4, true, true, true, true, true, true, true, true, false, true, "none")

Opts() = Opts(default_opts...)
Opts(xs::Vararg{Union{Int,Bool,Nothing},length(default_opts)}) = Opts(something.(xs, default_opts)...)

struct Edit{T}
    loc::T
    text::String
end

mutable struct Formatter{T}
    off::Int
    edits::T
    opts::Opts
    text
    lines::Vector{Tuple{Int,Int}}
end
