mutable struct TrySource{S} <: LineAt
    io::IO
    frozen::Int    # non-zero is frozen; count allows nested Try()
    zero::Int      # offset to lines (lines[x] contains line x+zero)
    right::Int     # rightmost expired column
    lines::Vector{S}
    TrySource(io::IO, line::S) where {S} = new{S}(io, 0, 0, 0, S[line])
end

function TrySource(io::IO)
    line = readline(io, keep=true)
    TrySource(io, line)
end

TrySource(s::S) where {S <: AbstractString} = TrySource(IOBuffer(s))

function expire(s::TrySource, i::LineIter)
    if s.frozen == 0
        n = i.line - s.zero
        if n > 0
            s.lines = s.lines[n:end]
            s.zero += (n - 1)
            if n > 1 || i.col > s.right; s.right = i.col
            end
        end
    end
end

function line_at(s::TrySource, i::LineIter; check::Bool=true)
    if check
        if i.line <= s.zero || (i.line == s.zero + 1 && i.col < s.right); throw(LineException())
        end
    end
    n = i.line - s.zero
    while length(s.lines) < n
        push!(s.lines, readline(s.io))
    end
    s.lines[n]
end

function iterate(s::TrySource, i::LineIter=LineIter(1, 1))
    ln = line_at(s, i; check=false)
    if i.col > ncodeunits(ln) && eof(s.io); return nothing
    end
    ln = line_at(s, i)
    c, col = iterate(ln, i.col)
    if col > ncodeunits(ln); return c, LineIter(i.line + 1, 1)
    end
    return c, LineIter(i.line, col)
end

firstindex(::TrySource) = LineIter(1, 1)

@auto_hash_equals mutable struct Try <: Delegate
    name::Symbol
    matcher::Matcher
    Try(matcher) = new(:Try, matcher)
end

@auto_hash_equals struct TryState <: DelegateState
    state::State
end

run(::Config, ::Try, ::Clean, _) = error("use Try only with TrySource")
run(c::Config{S}, m::Try, ::Clean, i) where {S <: TrySource} = run(c, m, TryState(CLEAN), i)

function run(c::Config{S}, m::Try, s::TryState, i) where {S <: TrySource}
    c.src.frozen += 1
    Run(m, s, m.matcher, s.state, i)
end

function ok(c::Config{S}, ::Try, ::TryState, t, i, r::Value) where {S <: TrySource}
    c.src.frozen -= 1
    Ok(TryState(t), i, r)
end

function fail(c::Config{S}, ::Try, ::TryState) where {S <: TrySource}
    c.src.frozen -= 1
    FAIL
end

function dispatch(c::NoCache{S}, o::Ok) where {S <: TrySource}
    (p, s) = pop!(c.stack)
    expire(c.src, o.iter)
    try
        ok(c, p, s, o.c_state, o.iter, o.val)
    catch err
        isa(err, FailException) ? FAIL : rethrow()
    end
end
function dispatch(c::Cache{S}, o::Ok) where {S <: TrySource}
    p, s, k = pop!(c.stack)
    expire(c.src, o.iter)
    try
        c.cache[k] = o
    catch err
        isa(err, CacheException) ? nothing : rethrow()
    end
    try
        ok(c, p, s, o.c_state, o.iter, o.val)
    catch err
        isa(err, FailException) ? FAIL : rethrow()
    end
end

parse_try(s, m; kw...) = parse_one(TrySource(s), m; kw...)
parse_try_dbg(s, m; kw...) = parse_one_dbg(TrySource(s), m; kw...)
parse_try_cache(s, m; kw...) = parse_one_cache(TrySource(s), m; kw...)
parse_try_cache_dbg(s, m; kw...) = parse_one_cache_dbg(TrySource(s), m; kw...)
