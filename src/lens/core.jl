using ..Match: postwalk

export @set, @lens, @reset, @modify
export set, modify
export ∘, compose, revcompose, var"⨟"
export Elems, Recursive, If, Props

const compose = ∘
revcompose(fs...) = ∘(reverse(fs)...)
if !isdefined(Base, Symbol("@var_str")); macro var_str(x); Symbol(x) end
end
const var"⨟" = revcompose

const Compo{O,I} = ComposedFunction{O,I}
in_type(::Type{Compo{O,I}}) where {O,I} = I
out_type(::Type{Compo{O,I}}) where {O,I} = O

abstract type Kind end
struct BySet <: Kind end
struct ByModify <: Kind end

Kind(x) = Kind(typeof(x))
Kind(::Type{T}) where {T} = BySet()
Kind(::Type{Compo{O,I}}) where {O,I} = kind(Kind(O), Kind(I))

kind(::BySet, ::BySet) = BySet()
kind(::BySet, ::ByModify) = ByModify()
kind(::ByModify, ::BySet) = ByModify()
kind(::ByModify, ::ByModify) = ByModify()

struct Value{V}; val::V end
(v::Value)(_) = v.val

set(x, l, v) = set(x, l, v, Kind(l))
set(x, l, v, ::BySet) = (L = typeof(l); error("Overload `Lens.set(x, ::$L, v)"))
set(x, l, v, ::ByModify) = modify(Value(v), x, l)
set(x, l::Compo, v, ::BySet) = set(x, l.inner, set(l.inner(x), l.outer, v))

modify(f, x, l) = modify(f, x, l, Kind(l))
modify(f, x, l, ::BySet) = set(x, l, f(l(x)))
modify(f, x, l, ::ByModify) = (L = typeof(l); error("Overload `Lens.modify(f, x, ::$L)`"))
modify(f, x, l::Compo, ::ByModify) = modify(y -> modify(f, y, l.outer), x, l.inner)

struct Elems end
Kind(::Type{<:Elems}) = ByModify()

modify(f, x, ::Elems) = map(f, x)

struct If{C}; cond::C end
Kind(::Type{<:If}) = ByModify()

modify(f, x, i::If) = i.cond(x) ? f(x) : x

struct Props end
Kind(::Type{<:Props}) = ByModify()

function map_props(f, x)
    ns = propertynames(x)
    if isempty(ns); x
    else
        c = constrof(typeof(x))
        ps = map(n -> f(getproperty(x, n)), ns)
        c(ps...)
    end
end

modify(f, x, ::Props) = map_props(f, x)

struct Recursive{D,L}; descend::D; lens::L end
Kind(::Type{Recursive{D,L}}) where {D,L} = ByModify()

modify(f, x, r::Recursive, ::ByModify) = modify(y -> r.descend(y) ? modify(f, y, r) : f(y), x, r.lens)

struct Field{F} end
(::Field{field})(x) where {field} = getproperty(x, field)

set(x, ::Field{field}, v) where {field} = set_props(x, (;field => v))

struct Indeces{I <: Tuple}; idxs::I end

Base.@propagate_inbounds (i::Indeces)(x) = getindex(x, i.idxs...)
Base.@propagate_inbounds set(x, i::Indeces, v) = set_index(x, v, i.idxs...)

struct Dynamic{F}; f::F end

Base.@propagate_inbounds (d::Dynamic)(x) = x[d.f(x)...]
Base.@propagate_inbounds set(x, d::Dynamic, v) = set_index(x, v, d.f(x)...)

Base.@propagate_inbounds set_index(xs...) = Base.setindex(xs...)
Base.@propagate_inbounds function set_index(xs::AbstractArray, v, I...)
    T = promote_type(eltype(xs), typeof(v))
    ys = similar(xs, T)
    if eltype(xs) !== Union{}; copy!(ys, xs)
    end
    ys[I...] = v
    ys
end
Base.@propagate_inbounds function set_index(x::AbstractDict, v, k)
    K = promote_type(keytype(x), typeof(k))
    V = promote_type(valtype(x), typeof(v))
    d = empty(x, K, V)
    copy!(d, x)
    d[k] = v
    d
end

fold_tree(f, init, x) = f(init, x)
fold_tree(f, init, e::Expr) = f(foldl((prev, x) -> fold_tree(f, prev, x), e.args; init), e)
need_dynamic(e) = fold_tree((yes, x) -> yes || x === :end || x === :_, false, e)
replace_underscore(e, to) = postwalk(x -> x === :_ ? to : x, e)

function lower_idx(s::Symbol, x, dim)
    if Meta.isexpr(x, :call); return Expr(:call, lower_idx.(s, x.args, dim)...)
    elseif x === :end; return dim === nothing ? :($(Base.lastindex)($s)) : :($(Base.lastindex)($s, $dim))
    end
    x
end

function parse_lenses(e)
    if @mate(e, (a_ |> b_))
        x, a = parse_lenses(a)
        b = try
            y, c = parse_lenses(b)
            y == esc(:_) ? c : (esc(b),)
        catch ArgumentError
            c = (esc(b),)
        end
        return x, tuple(a..., b...)
    elseif @mate(e, a_[b__])
        x, a = parse_lenses(a)
        if any(need_dynamic, b)
            @gensym collection
            b = replace_underscore.(b, collection)
            dims = length(b) == 1 ? nothing : 1:length(b)
            b = esc.(lower_idx.(collection, b, dims))
            l = :($Dynamic($(esc(collection)) -> ($(b...),)))
        else
            b = esc(Expr(:tuple, b...))
            l = :($Indeces($b))
        end
    elseif @mate(e, a_.b_)
        b isa Union{Symbol,String} || throw(ArgumentError(string("Needed symbol or string in :($e), got `$b`")))
        x, a = parse_lenses(a)
        l = :($Field{$(QuoteNode(b))}())
    elseif @mate(e, f_(a_))
        x, a = parse_lenses(a)
        l = esc(f)
    else 
        x = esc(e)
        return x, ()
    end
    return (x, tuple(a..., l))
end

lenses() = identity
lenses(xs...) = revcompose(xs...)

function parse_one_lense(e)
    x, ls = parse_lenses(e)
    x, Expr(:call, lenses, ls...)
end

function get_update_op(x::Symbol)
    s = String(x)
    if !endswith(s, '=') || isdefined(Base, x); throw(ArgumentError("Op $x not an assignment"))
    end
    Symbol(s[1:end - 1])
end

struct Update{O,V}
    op::O
    val::V
end
(u::Update)(x) = u.op(x, u.val)

function make_set(xform, e::Expr; overwrite::Bool=false)
    @assert e.head isa Symbol
    @assert length(e.args) == 2
    ref, v = e.args
    x, l = parse_one_lense(ref)
    t = overwrite ? x : gensym("_")
    v = esc(v)
    if e.head == :(=)
        quote
            l = ($xform)($l)
            $t = $set($x, l, $v)
        end
    else
        op = get_update_op(e.head)
        f = :($Update($op, $v))
        quote
            l = ($xform)($l)
            $t = $modify($f, $x, l)
        end
    end
end

macro set(x)
    make_set(identity, x, overwrite=false)
end

macro reset(x)
    make_set(identity, x, overwrite=true)
end

function make_modify(xform, f, e)
    f = esc(f)
    x, l = parse_one_lense(e)
    :(let
        l = $(xform)($l)
        ($modify)($f, $x, l)
    end)
end

macro modify(f, e)
    make_modify(identity, f, e)
end

function make_lens(xform, e)
    x, l = parse_one_lense(e)
    if x != esc(:_); throw(ArgumentError("Needed '_' start in $e, got $x"))
    end
    :($(xform)($l))
end

macro lens(e)
    make_lens(identity, e)
end

show(io::IO, ::Field{field}) where {field} = print(io, "(@lens _.$field)")
show(io::IO, l::Indeces) = print(io, "(@lens _[", join(repr.(l.idxs), ", "), "])")
Base.show(io::IO, l::Union{Indeces,Field}) = show(io, l)
Base.show(io::IO, ::MIME"text/plain", l::Union{Indeces,Field}) = show(io, l)

show_compo_order(x) = (show_compo_order(stdout, x); println())
show_compo_order(io::IO, x) = show(io, x)
function show_compo_order(io::IO, l::Compo)
    print(io, "(")
    show_compo_order(io, l.outer)
    print(io, " ∘  ")
    show_compo_order(io, l.inner)
    print(io, ")")
end

set(x, ::typeof(last), v) = @set x[lastindex(x)] = v
set(x, ::typeof(first), v) = @set x[firstindex(x)] = v
set(x, ::typeof(identity), v) = v
set(x, ::typeof(inv), y) = inv(y)

set(a::Array, ::typeof(eltype), T::Type) = collect(T, a)
set(n::Number, ::typeof(eltype), T::Type) = T(n)
set(::Type{<:Number}, ::typeof(eltype), ::Type{T}) where {T} = T
set(::Type{<:Array{<:Any,N}}, ::typeof(eltype), ::Type{T}) where {N,T} = Array{T,N}
set(::Type{<:Dict}, ::typeof(eltype), ::Type{Pair{K,V}}) where {K,V} = Dict{K,V}
set(d::Dict, ::typeof(eltype), ::Type{T}) where {T} = set(typeof(d), eltype, T)(d)

set(d::Dict, l::Union{typeof(keytype),typeof(valtype)}, T::Type) = set(typeof(d), l, T)(d)
set(::Type{<:Dict{<:Any,V}}, ::typeof(keytype), ::Type{K}) where {K,V} = Dict{K,V}
set(::Type{<:Dict{K}}, ::typeof(valtype), ::Type{V}) where {K,V} = Dict{K,V}

set(p, ::typeof(splitext), (stem, ext)) = string(stem, ext)
set(p, ::typeof(splitdir), (dir, last)) = joinpath(dir, last)
set(p, ::typeof(splitdrive), (drive, rest)) = joinpath(drive, rest)
set(p, ::typeof(splitpath), ps) = joinpath(ps...)
set(p, ::typeof(dirname), n) = @set splitdir(p)[1] = n
set(p, ::typeof(basename), n) = @set splitdir(p)[2] = n

set(::Real, ::typeof(real), v) = v
set(x, ::typeof(real), v) = v + im * imag(x)
set(x, ::typeof(imag), v) = real(x) + im * v
