mutable struct Debug{S,I} <: Config{S,I}
    src::S
    stack::Vector
    delegate::Config{S,I}
    depth::Vector{Int}
    abs_depth::Int
    max_depth::Int
    max_iter
    n_calls::Int
    function Debug{S,I}(s::S; delegate=NoCache, kw...) where {S,I}
        d = delegate{S,I}(s; kw...)
        new{S,I}(d.src, d.stack, d, Vector{Int}(), 0, 0, firstindex(d.src), 0)
    end
end

Debug(s; kw...) = Debug{typeof(s),typeof(firstindex(s))}(s; kw...)

parent(d::Debug) = parent(d.delegate)

function dispatch(d::Debug, r::Run)
    if isa(r.parent, Trace); push!(d.depth, 0)
    end
    if length(d.depth) > 0
        debug(d, r)
        d.depth[end] += 1
    end
    d.abs_depth += 1
    d.max_depth = max(d.max_depth, d.abs_depth)
    d.n_calls += 1
    dispatch(d.delegate, r)
end

function dispatch(d::Debug, o::Ok)
    if length(d.depth) > 0
        d.depth[end] -= 1
        debug(d, o)
    end
    d.abs_depth -= 1
    d.max_iter = max(d.max_iter, o.iter)
    if isa(parent(d), Trace); @assert 0 == pop!(d.depth)
    end
    dispatch(d.delegate, o)
end

function dispatch(d::Debug, f::Fail)
    if length(d.depth) > 0
        d.depth[end] -= 1
        debug(d, f)
    end
    d.abs_depth -= 1
    if isa(parent(d), Trace); @assert 0 == pop!(d.depth)
    end
    dispatch(d.delegate, f)
end

MAX_RES = 50
MAX_SRC = 10
MAX_IND = 10

if VERSION < v"0.4-"
    shorten(s) = s
else
#   shorten(s) = replace(s, r"(?:[a-zA-Z]+\.)+([a-zA-Z]+)", s"\1")
    shorten(s) = replace(s, r"(?:[a-zA-Z]+\.)+([a-zA-Z]+)" => Base.SubstitutionString("\1"))
end

function truncate(s::AbstractString, n=10)
    if length(s) <= n; return s
    end
    s = shorten(s)
    l = length(s)
    if l <= n; return s
    else
        j = div(2 * n + 1, 3) - 2
        # j + 3 + (l - k + 1) = n
        k = j + 3 + l + 1 - n
        s[1:j] * "..." * s[k:end]
    end
end

pad(s::AbstractString, n::Int) = s * repeat(" ", n - length(s))
indent(d::Debug; max=MAX_IND) = repeat(" ", d.depth[end] % max)

src(::Any, ::Any; max=MAX_SRC) = pad(truncate("...", max), max)
src(s::AbstractString, i::Int; max=MAX_SRC) = pad(truncate(escape_string(s[i:end]), max), max)

function debug(d::Debug{S}, r::Run) where {S <: AbstractString}
    # @printf("%3d:%s %02d %s%s->%s\n", r.iter, src(d.src, r.iter), d.depth[end], indent(d), r.parent.name, r.child.name)
end

function short(v::Value)
    r = string(v)
    if occursin(r"^Any", r); r = r[4:end]
    end
    truncate(r, MAX_RES)
end

function debug(d::Debug{S}, o::Ok) where {S <: AbstractString}
    # @printf("%3d:%s %02d %s%s<-%s\n", o.iter, src(d.src, o.iter), d.depth[end], indent(d), parent(d).name, short(o.val))
end

function debug(d::Debug{S}, ::Fail) where {S <: AbstractString}
    # @printf("   :%s %02d %s%s<-!!!\n", pad(" ", MAX_SRC), d.depth[end], indent(d), parent(d).name)
end

function src(s::LineAt, i::LineIter; max=MAX_SRC)
    try
        pad(truncate(escape_string(forwards(s, i)), max), max)
    catch err
        if isa(err, LineException); pad(truncate("[unavailable]", max), max)
        else rethrow()
        end
    end
end
   
function debug(d::Debug{S}, r::Run) where {S <: LineAt}
    # @printf("%3d,%-3d:%s %02d %s%s->%s\n", r.iter.line, r.iter.column, src(d.src, r.iter), d.depth[end], indent(d), r.parent.name, r.child.name)
end

function debug(d::Debug{S}, o::Ok) where {S <: LineAt}
    # @printf("%3d,%-3d:%s %02d %s%s<-%s\n", o.iter.line, o.iter.column, src(d.src, o.iter), d.depth[end], indent(d), parent(d).name, short(o.val))
end

function debug(d::Debug{S}, ::Fail) where {S <: LineAt}
    # @printf("       :%s %02d %s%s<-!!!\n", pad(" ", MAX_SRC), d.depth[end], indent(d), parent(d).name)
end

@auto_hash_equals mutable struct Trace <: Delegate
    name::Symbol
    matcher::Matcher
    Trace(matcher) = new(:Trace, matcher)
end

@auto_hash_equals struct TraceState <: DelegateState
    state::State
end

ok(::Config, ::Trace, s, t, i, v::Value) = Ok(TraceState(t), i, v)
fail(::Config, ::Trace, s) = FAIL

parse_one_cache_dbg = make_one(Debug; delegate=Cache)
parse_one_nocache_dbg = make_one(Debug; delegate=NoCache)
parse_one_dbg = parse_one_nocache_dbg
parse_dbg = parse_one_nocache_dbg

parse_all_cache_dbg = make_all(Debug; delegate=Cache)
parse_all_nocache_dbg = make_all(Debug; delegate=NoCache)
parse_all_dbg = parse_all_cache_dbg

parse_lines_dbg(s, matcher; kw...) = parse_one_dbg(Lines(s), matcher; kw...)
parse_lines_cache_dbg(s, matcher; kw...) = parse_one_cache_dbg(Lines(s), matcher; kw...)
