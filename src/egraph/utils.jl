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
