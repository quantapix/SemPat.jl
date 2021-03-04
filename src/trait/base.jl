abstract type QTrait end

macro traitdef(x)
  :(struct $(esc(x)) <: QTrait end)
end

abstract type Not{T <: QTrait} <: QTrait end

trait(::Type{T}) where {T <: QTrait} = Not{T}
trait(::Type{Not{T}}) where {T <: QTrait} = trait(T)

strip_not(::Type{T}) where {T <: QTrait} = T
strip_not(::Type{Not{T}}) where {T <: QTrait} = Not{T}
strip_not(::Type{Not{Not{T}}}) where {T <: QTrait} = strip_not(T)

is_trait(t::Type{T}) where {T <: QTrait} = trait(t) == strip_not(t) ? true : false
is_trait(_) = error("Not a trait")

abstract type Param end
abstract type Nil <: Param end
abstract type Cons{A,B <: Param} <: Param end

abstract type PTrait{P <: Param} end

abstract type TraitInstance end

struct Sig
    name::Symbol
    ts
    ret
    ws::Vector{Any}
    infer::Set{Symbol}
end

struct Code
    name::Symbol
    ex::Expr
end

Method = Union{Sig,Code,LineNumberNode}

struct Wheres
    ts::Vector{Expr}
    ws::Vector{Symbol}
end

Wheres(ws::Ws) where Ws <: AbstractArray{Symbol} = Wheres([:(::Type{$w}) for w in ws], ws)

