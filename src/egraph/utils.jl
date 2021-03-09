mutable struct UnionFind{T <: Integer}
    ps::Vector{T}
end

UnionFind(n::T) where {T <: Integer} = UnionFind{T}(collect(Base.OneTo(n)))
UnionFind{T}(n::Integer) where {T <: Integer} = UnionFind{T}(collect(Base.OneTo(n)))

Base.length(u::UnionFind) = length(u.ps)
Base.eltype(::Type{UnionFind{T}}) where {T <: Integer} = T

function _find!(ps::Vector{T}, x::Integer) where {T <: Integer}
    p = ps[x]
    @inbounds if ps[p] != p
        ps[x] = p = _find2!(ps, p)
    end
    p
end

function _find2!(ps::Vector{T}, x::Integer) where {T <: Integer}
    @inbounds p = ps[x]
    @inbounds if ps[p] != p
        ps[x] = p = _find2!(ps, p)
    end
    p
end

find!(u::UnionFind{T}, x::T) where {T <: Integer} = _find!(u.ps, x)

is_colloc(u::UnionFind{T}, x::T, y::T) where {T <: Integer} = find!(u, x) == find!(u, y)

function Base.union!(u::UnionFind{T}, x::T, y::T) where {T <: Integer}
    ps = u.ps
    x = _find!(ps, x)
    y = _find!(ps, y)
    if x != y
        x > y || (x, y = y, x)
        @inbounds ps[y] = x
    end
    x
end

function Base.push!(u::UnionFind{T}) where {T <: Integer}
    x = length(u)
    x < typemax(T) || throw(ArgumentError("Capacity of UnionFind{$T} is $(typemax(T))"))
    x = x + one(T)
    push!(u.ps, x)
    x
end


function binarize!(e, op::Symbol)
    f(e) = if (isexpr(e, :call) && e.args[1] == op && length(e.args) > 3)
        foldl((x, y) -> Expr(:call, op, x, y), e.args[2:end])
    else e end
    df_walk!(f, e)
end

cleanast(ex) = rm_lines(ex) |>
    x -> binarize!(x, :(+)) |>
    x -> binarize!(x, :(*))


function df_walk!(f, e, f_args...; skip=Vector{Symbol}(), skip_call=false)
    if !(e isa Expr) || e.head in skip; return f(e, f_args...)
    end
    start = 1
    if skip_call && isexpr(e, :call); start = 2 end
    e.args[start:end] = e.args[start:end] .|> x ->
        df_walk!(f, x, f_args...; skip=skip, skip_call=skip_call)
    f(e, f_args...)
end

function df_walk(f, e, f_args...; skip=Vector{Symbol}(), skip_call=false)
    if !(e isa Expr) || e.head in skip; return f(e, f_args...)
    end
    start = 1
    if skip_call && isexpr(e, :call); start = 2
    end
    ne = copy(e)
    ne.args[start:end] = ne.args[start:end] .|> x ->
        df_walk(f, x, f_args...; skip=skip, skip_call=skip_call)
    return f(ne, f_args...)
end

function bf_walk!(f, e, f_args...; skip=Vector{Symbol}(), skip_call=false)
    if !(e isa Expr) || e.head in skip; return f(e, f_args...)
    end
    e = f(e, f_args...)
    if !(e isa Expr) return e end
    start = 1
    if skip_call && isexpr(e, :call); start = 2
    end
    e.args[start:end] = e.args[start:end] .|> x ->
        bf_walk!(f, x, f_args...; skip=skip, skip_call=skip_call)
    return e
end

function bf_walk(f, e, f_args...; skip=Vector{Symbol}(), skip_call=false)
    if !(e isa Expr) || e.head in skip; return f(e, f_args...)
    end
    ne = copy(e)
    ne = f(e, f_args...)
    if !(ne isa Expr) return ne end
    start = 1
    if skip_call && isexpr(ne, :call); start = 2
    end
    ne.args[start:end] = ne.args[start:end] .|> x ->
        bf_walk(f, x, f_args...; skip=skip, skip_call=skip_call)
    return ne
end
    
interp_dol(e::Expr, m::Module) = Meta.isexpr(e, :$) ? m.eval(e.args[1]) : e
interp_dol(x, ::Module) = x

interpolate_dollar(e, m::Module) = df_walk(interp_dol, e, m)

function normalize(f, datum, fargs...; callback=() -> ())
    old = datum
    new = f(old, fargs...)
    while new != old
        old = new
        new = f(old, fargs...)
        callback()
    end
    new
end
export normalize

function normalize_nocycle(f, datum, fargs...; callback=() -> ())
    hist = UInt[]
    push!(hist, hash(datum))
    x = f(datum, fargs...)
    while hash(x) ∉ hist
        push!(hist, hash(x))
        x = f(x, fargs...)
        callback()
end
x
end
export normalize_nocycle
