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


# ====

"""Add a dollar expression"""
dollar(v) = Expr(:$, v)
"Make a block expression from an array of exprs"
block(vs...) = Expr(:block, vs...)
"Add a & expression"
amp(v) = Expr(:&, v)

"""
Remove LineNumberNode from quoted blocks of code
"""
rmlines(e::Expr) = Expr(e.head, map(rmlines, filter(x -> !(x isa LineNumberNode), e.args))...)
rmlines(a) = a

"""
HARD FIX of n-arity of operators in `Expr` trees
"""
function binarize!(e, op::Symbol)
    f(e) = if (isexpr(e, :call) && e.args[1] == op && length(e.args) > 3)
        foldl((x, y) -> Expr(:call, op, x, y), e.args[2:end])
    else e end
    
        df_walk!(f, e)
end

"""
Binarize n-ary operators (`+` and `*`) and call [`rmlines`](@ref)
"""
cleanast(ex) = rmlines(ex) |>
    x -> binarize!(x, :(+)) |>
    x -> binarize!(x, :(*))


"""
Depth First Walk (Tree Postwalk) on expressions, mutates expression in-place.
"""
function df_walk!(f, e, f_args...; skip=Vector{Symbol}(), skip_call=false)
    if !(e isa Expr) || e.head ∈ skip
        return f(e, f_args...)
    end
    # println("walking on", e)
    start = 1
    # skip walking on function names
    if skip_call && isexpr(e, :call)
        start = 2
    end
    e.args[start:end] = e.args[start:end] .|> x ->
        df_walk!(f, x, f_args...; skip=skip, skip_call=skip_call)
    return f(e, f_args...)
end

"""
Depth First Walk (Tree Postwalk) on expressions. Does not mutate expressions.
"""
function df_walk(f, e, f_args...; skip=Vector{Symbol}(), skip_call=false)
    if !(e isa Expr) || e.head ∈ skip
        return f(e, f_args...)
    end
    start = 1
    # skip walking on function names
    if skip_call && isexpr(e, :call)
        start = 2
    end

    ne = copy(e)
    ne.args[start:end] = ne.args[start:end] .|> x ->
        df_walk(f, x, f_args...; skip=skip, skip_call=skip_call)
    return f(ne, f_args...)
end



## Breadth First Walk on expressions

"""
Breadth First Walk (Tree Prewalk) on expressions mutates expression in-place.
"""
function bf_walk!(f, e, f_args...; skip=Vector{Symbol}(), skip_call=false)
    if !(e isa Expr) || e.head ∈ skip
        return f(e, f_args...)
    end
    e = f(e, f_args...)
    if !(e isa Expr) return e end
    start = 1
    # skip walking on function names
    if skip_call && isexpr(e, :call)
        start = 2
    end
    e.args[start:end] = e.args[start:end] .|> x ->
        bf_walk!(f, x, f_args...; skip=skip, skip_call=skip_call)
    return e
end


"""
Breadth First Walk (Tree Prewalk) on expressions. Does not mutate expressions.
"""
function bf_walk(f, e, f_args...; skip=Vector{Symbol}(), skip_call=false)
    if !(e isa Expr) || e.head ∈ skip
        return f(e, f_args...)
    end
    ne = copy(e)
    ne = f(e, f_args...)
    if !(ne isa Expr) return ne end
    start = 1
    # skip walking on function names
    if skip_call && isexpr(ne, :call)
        start = 2
    end
    ne.args[start:end] = ne.args[start:end] .|> x ->
        bf_walk(f, x, f_args...; skip=skip, skip_call=skip_call)
    return ne
end
    
interp_dol(ex::Expr, mod::Module) =
    Meta.isexpr(ex, :$) ? mod.eval(ex.args[1]) : ex
interp_dol(any, mod::Module) = any

function interpolate_dollar(ex, mod::Module)
    df_walk(interp_dol, ex, mod)
end

"""
Iterates a function `f` on `datum` until a fixed point is reached where `f(x) == x`
"""
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

"""
Like [`normalize`](@ref) but keeps a vector of hashes to detect cycles,
returns the current datum when a cycle is detected
"""
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
