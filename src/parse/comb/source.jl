abstract type LineAt end

mutable struct Lines{S} <: LineAt
    io::IO
    zero::Int
    limit::Int
    lines::Vector{S}
    Lines(io::IO, ln::S; limit=-1) where {S} = new{S}(io, 0, limit, S[ln])
end

function Lines(io::IO; limit=-1)
    ln = readline(io, keep=true)
    Lines(io, ln; limit=limit)
end

Lines(ln::S; limit=-1) where {S <: AbstractString} = Lines(IOBuffer(ln); limit=limit)

struct LineException <: FailException end

@auto_hash_equals struct LineIter
    line::Int
    col::Int
end

isless(a::LineIter, b::LineIter) = a.line < b.line || (a.line == b.line && a.col < b.col)

function line_at(ls::Lines, i::LineIter; check::Bool=true)
    if check && i.line <= ls.zero || i.col < 1; throw(LineException())
    end
    n = i.line - ls.zero
    while length(ls.lines) < n
        push!(ls.lines, readline(ls.io, keep=true))
    end
    while ls.limit > 0 && length(ls.lines) > ls.limit
        ls.zero += 1
        pop!(ls.lines)
    end
    ln = ls.lines[i.line - ls.zero]
    if check && i.col > length(ln); throw(LineException())
    end
    return ln
end

function iterate(ls::Lines, i::LineIter=LineIter(1, 1))
    ln = line_at(ls, i, check=false)
    if iterate(ln, i.col) === nothing && eof(ls.io); return nothing
    end
    ln = line_at(ls, i)
    c, col = iterate(ln, i.col)
    if iterate(ln, col) === nothing && eof(ls.io); return c, LineIter(i.line + 1, 1)
    end
    return c, LineIter(i.line, col)
end

firstindex(::Lines) = LineIter(1, 1)

function diagnostic(ls::LineAt, i::LineIter, msg)
    ln = "[Not available]"
    try
        ln = line_at(ls, i)
        if is_nl(ln[end]); ln = ln[1:end - 1]
        end
    catch err
        if !isa(err, FailException); throw(err)
        end
    end
    fmt_error(i.line, i.col, ln, msg)
end

function forwards(ls::LineAt, i::LineIter)
    ln = line_at(ls, i; check=false)
    if iterate(ln, i.col) === nothing && eof(ls.io); return ""
    end
    return SubString(line_at(ls, i), i.col)
end

function discard(ls::LineAt, i::LineIter, n)
    while n > 0 && iterate(ls, i) !== nothing
        ln = line_at(ls, i)
        available = length(ln) - i.col + 1
        if n < available
            i = LineIter(i.line, i.col + n)
            n = 0
        else
            i = LineIter(i.line + 1, 1)
            n -= available
        end
    end
    i
end
