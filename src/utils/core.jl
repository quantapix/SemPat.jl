struct UnpackException <: Exception; msg end

macro auto_hash_equals(t)
    @assert t.head == :type || t.head == :struct
    _unpack(s::Symbol) = s
    function _unpack(e::Expr)
        h, xs = e.head, e.args
        if h == :macrocall; _unpack(xs[2])
        else
            i = h == :type || h == :struct ? 2 : 1
            if length(xs) >= i && isa(xs[i], Symbol); xs[i]
            elseif length(xs) >= i && isa(xs[i], Expr) && xs[i].head in (:(<:), :(::)); _unpack(xs[i].args[1])
            elseif length(xs) >= i && isa(xs[i], Expr) && xs[i].head == :curly; _unpack(xs[i].args[1])
            else throw(UnpackException("cannot find name in $(e)"))
            end
        end
    end
    n = _unpack(t)
    ns = Vector{Symbol}()
    for x in t.args[3].args
        try; push!(ns, _unpack(x))
        catch ParseException end
    end
    @assert length(ns) > 0
    function hash(n, ns)
        f(x) = x == 0 ? :(hash($(QuoteNode(n)), h)) : :(hash(a.$(ns[x]), $(f(x - 1))))
        :(Base.hash(a::$(n), h::UInt) = $(f(length(ns))))
    end
    function equals(n, ns)
        f(x) = x == 0 ? :true : :(isequal(a.$(ns[x]), b.$(ns[x])) && $(f(x - 1)))
        :(Base.:(==)(a::$(n), b::$(n)) = $(f(length(ns))))
    end
    quote
        Base.@__doc__($(esc(t)))
        $(esc(hash(n, ns)))
        $(esc(equals(n, ns)))
    end
end
export @auto_hash_equals

macro reexport(e)
    isa(e, Expr) && (e.head == :module || e.head == :using || (e.head == :toplevel && all(x -> isa(x, Expr) && x.head == :using, e.args))) || error("@reexport: syntax error")
    if e.head == :module
        ms = Any[e.args[2]]
        e = Expr(:toplevel, e, :(using .$(e.args[2])))
    elseif e.head == :using && all(x -> isa(x, Symbol), e.args); ms = Any[e.args[end]]
    elseif e.head == :using && e.args[1].head == :(:)
        xs = [x.args[end] for x in e.args[1].args[2:end]]
        return esc(Expr(:toplevel, e, :(eval(Expr(:export, $xs...)))))
    else ms = Any[x.args[end] for x in e.args]
    end
    esc(Expr(:toplevel, e, [:(eval(Expr(:export, names($m)...))) for m in ms]...))
end

macro reexport2(m)
    m = __module__.eval(m)
    ns = names(m)
    x = nameof(m)
    ns = [n for n in ns if n !== x]
    isempty(ns) ? nothing : esc(:(export $(ns...)))
end

@generated constrof(::Type{T}) where T = getfield(parentmodule(T), nameof(T))
constrof(::Type{<:Tuple}) = tuple
constrof(::Type{<:NamedTuple{ns}}) where ns = NamedTupleConstr{ns}()
export constrof

struct NamedTupleConstr{ns} end

@generated function (::NamedTupleConstr{ns})(xs...) where ns
    quote
        Base.@_inline_meta
        $(NamedTuple{ns,Tuple{xs...}})(xs)
    end
end

set_props(x; kw...) = set_props(x, (;kw...))
set_props(x, patch::NamedTuple) = _set_props(x, patch)
export set_props

_set_props(x, ::typeof(NamedTuple())) = x
@generated function _set_props(x, patch::NamedTuple)
    ns = fieldnames(x)
    ps = fieldnames(patch)
    if issubset(ps, ns)
        xs = map(n -> n in ps ? :(patch.$n) : :(x.$n), ns)
        Expr(:block, Expr(:meta, :inline), Expr(:call, :(constrof($x)), xs...))
    else :(unknown_field(x, patch))
    end
end

function unknown_field(x, patch)
    O = typeof(x)
    P = typeof(patch)
    m = "Cannot assign $(fieldnames(P)) to $(fieldnames(O)), overload ConstructionBase.setproperties(x::$O, patch::NamedTuple)"
    throw(ArgumentError(m))
end

function uncurry_call_argtail(f)
    function (_, args...)
        f(args...)
    end
end
