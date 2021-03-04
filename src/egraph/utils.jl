mutable struct UnionFind{T <: Integer}
    parents::Vector{T}
end

UnionFind(n::T) where {T <: Integer} = UnionFind{T}(collect(Base.OneTo(n)), zeros(T, n), n)
UnionFind{T}(n::Integer) where {T <: Integer} = UnionFind{T}(collect(Base.OneTo(T(n))), zeros(T, T(n)), T(n))

find!(u::UnionFind{T}, x::T) where {T <: Integer} = _find!(u.parents, x)

function _find!(ps::Vector{T}, x::Integer) where {T <: Integer}
    p = ps[x]
    @inbounds if ps[p] != p; ps[x] = p = _find2!(ps, p)
    end
    p
end

function _find2!(ps::Vector{T}, x::Integer) where {T <: Integer}
    @inbounds p = ps[x]
    @inbounds if ps[p] != p; ps[x] = p = _find2!(ps, p)
    end
    p
end

in_same_set(u::UnionFind{T}, x::T, y::T) where {T <: Integer} = find!(u, x) == find!(u, y)

Base.length(u::UnionFind) = length(u.parents)

function Base.union!(u::UnionFind{T}, x::T, y::T) where {T <: Integer}
    ps = u.parents
    x = _find!(ps, x)
    y = _find!(ps, y)
    if x != y
        x > y && (x, y = y, x)
        @inbounds ps[y] = x
    end
    x, y
end

function Base.push!(u::UnionFind{T}) where {T <: Integer}
    x = length(u)
    x < typemax(T) || throw(ArgumentError("Max number of elems in UnionFind{$T} is $(typemax(T))"))
    x = x + one(T)
    push!(u.parents, x)
    x
end
