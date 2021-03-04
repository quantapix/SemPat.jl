head(::QExpr{T}) where T = T
args(e::QExpr) = e.args
first(e::QExpr) = first(args(e))
last(e::QExpr) = last(args(e))
gat_typeof(e::QExpr) = nameof(typeof(e))
gat_type_args(e::QExpr) = e.type_args
cons_name(e::QExpr) = head(e)
cons_name(e::QExpr{:gen}) = gat_typeof(e)
syntax_mod(e::QExpr) = parentmodule(typeof(e))

equations(p::Picture) = p.equations

gens(p::Picture) = collect(Iterators.flatten(p.gens))
gens(p::Picture, s::Symbol) = p.gens[s]
gens(p::Picture, t::Type) = gens(p, nameof(t))

mod_ref(s::Symbol) = GlobalRef(Present, s)

Base.hash(e::QExpr, h::UInt) = hash(args(e), hash(head(e), h))

function Base.:(==)(e1::QExpr{T}, e2::QExpr{S}) where {T,S}
    T == S && e1.args == e2.args && e1.type_args == e2.type_args
end
function Base.:(==)(p1::Picture, p2::Picture)
    p1.syntax == p2.syntax && p1.gens == p2.gens && p1.equations == p2.equations
end

function Base.copy(p::Picture{T,Name}) where {T,Name}
    Picture{T,Name}(p.syntax, map(copy, p.gens), copy(p.gen_name_index), copy(p.equations))
end

function Base.nameof(e::QExpr{:gen})
    n = first(e)
    isnothing(n) ? nothing : Symbol(n)
end

function gen(p::Picture, n)
    t, i = p.gen_name_index[n]
    p.gens[t][i]
end
Base.getindex(p::Picture, n) = gen.(Ref(p), n)

has_type(t::Theory, n::Symbol)::Bool = findfirst(x -> x.name == n, t.types) !== nothing
has_gen(p::Picture, n) = haskey(p.gen_name_index, n)

function add_type_dispatch(e::Expr, t::SyEx)::Expr
    @match e begin
        (Expr(:call, n, xs...) => Expr(:call, n, :(::Type{$t}), xs...))
        _ => throw(ParseError("Invalid call expr $e"))
    end
end

function expand_in_ctx(e, ps::Vector{Symbol}, c::Ctxt, t::Theory)
    @match e begin
        Expr(:call, n::Symbol, xs...) => Expr(:call, n, [expand_in_ctx(x, ps, c, t) for x in xs]...)
        n::Symbol => begin
            if n in ps; n
            elseif haskey(c, n); expand_sym(n, ps, c, t)
            else error("Name $n missing in $c")
            end
        end
        _ => throw(ParseError("Invalid raw expr $e"))
    end
end

function expand_sym(s::Symbol, ps::Vector{Symbol}, c::Ctxt, t::Theory)
    ns = collect(keys(c))
    beg = findfirst(ns .== s)
    for n in ns[beg + 1:end]
        e = c[n]
        if isa(e, Expr) && e.head == :call && s in e.args[2:end]
            cons = get_type(t, e.args[1])
            access = cons.params[findfirst(e.args[2:end] .== s)]
            return expand_in_ctx(Expr(:call, access, n), ps, c, t)
        end
    end
    error("Name $s is not explicit in $ps for $c")
end

expand_term_type(c::TermCons, t::Theory) = isa(c.typ, Symbol) ? c.typ : expand_in_ctx(c.typ, c.params, c.ctx, t)

function replace_syms(d::AbstractDict, f::QFunc)::QFunc
    QFunc(
        Expr(f.call.head, f.call.args[1], (replace_syms(d, x) for x in f.call.args[2:end])...),
        isnothing(f.ret) ? nothing : replace_syms(d, f.ret),
        isnothing(f.code) ? nothing : replace_syms(d, f.code),
        f.doc)
end

function replace_types(d::Dict, t::Theory)::Theory
    Theory(
        [replace_types(d, x) for x in t.types],
        [replace_types(d, x) for x in t.terms],
        [replace_types(d, x) for x in t.axioms],
        replace_types(d, t.aliases))
end
function replace_types(d::Dict, c::TypeCons)::TypeCons
    TypeCons(replace_syms(d, c.name), c.params, replace_types(d, c.ctx), c.doc)
end
function replace_types(d::Dict, c::TermCons)::TermCons
    TermCons(c.name, c.params, replace_syms(d, c.typ), replace_types(d, c.ctx), c.doc)
end
function replace_types(d::Dict, c::AxiomCons)::AxiomCons
    AxiomCons(c.name, replace_syms(d, c.left), replace_syms(d, c.right), replace_types(d, c.ctx), c.doc)
end
function replace_types(d::Dict, aliases::Dict)::Dict
    Dict(x => replace_syms(d, aliases[x]) for x in keys(aliases))
end
function replace_types(d::Dict, c::Ctxt)::Ctxt
    Ctxt(((n => @match e begin
        (Expr(:call, s::Symbol, xs...) => Expr(:call, replace_syms(d, s), xs...))
        s::Symbol => replace_syms(d, s)
    end) for (n, e) in c))
end

function replace_nullary(e, t::Theory)
    @match e begin
        Expr(:call, n::Symbol) => begin
            ts = t.terms[findall(x -> x.name == n, t.terms)]
            @assert length(ts) == 1
            Expr(:call, n, ts[1].typ)
        end
        Expr(:call, n::Symbol, xs...) => Expr(:call, n, [replace_nullary(x, t) for x in xs]...)
        _ => e
    end
end

function cast_picture(x::SyEx, b::Expr)::Expr
    @assert b.head == :block
    e = Expr(:block)
    append_expr!(e, :(_picture = $x))
    for x in strip_lines(b).args
        append_expr!(e, cast_stmt(x))
    end
    append_expr!(e, :(_picture))
    e
end

function cast_stmt(e::Expr)::Expr
    @match e begin
        Expr(:(::), n::Symbol, ty) => cast_gen(n, ty)
        Expr(:(::), Expr(:tuple, xs...), ty) => Expr(:block, (cast_gen(x, ty) for x in xs)...)
        Expr(:(::), ty) => cast_gen(nothing, ty)
        Expr(:(:=), n::Symbol, def) => cast_def(n, def)
        Expr(:call, :(==), l, r) => cast_equ(l, r)
        _ => throw(ParseError("Invalid presentation statement $e"))
    end
end

function cast_gen(n::Union{Symbol,Nothing}, ty)::Expr
    f, xs = @match ty begin
        n::Symbol => (n, [])
        Expr(:call, n::Symbol, xs...) => (n, xs)
        _ => throw(ParseError("Invalid type expr $ty"))
    end
    e = Expr(:call, f, isnothing(n) ? :nothing : QuoteNode(n), xs...)
    Expr(:call, mod_ref(:add_gen!), :_picture, cast_expr(e))
end

cast_def(n::Symbol, def)::Expr = Expr(:call, mod_ref(:add_def!), :_picture, QuoteNode(n), cast_expr(def))
cast_equ(l, r)::Expr = Expr(:call, mod_ref(:add_equ!), :_picture, cast_expr(l), cast_expr(r))

function cast_expr(x)
    @match x begin
        Expr(:call, n::Symbol, xs...) => Expr(:call, GlobalRef(Syntax, :invoke_term), :(_picture.syntax), QuoteNode(n), map(cast_expr, xs)...)
        n::Symbol => Expr(:call, mod_ref(:gen), :_picture, QuoteNode(n))
        _ => x
    end
end

function add_gen!(p::Picture, x)
    n, t = first(x), gat_typeof(x)
    gs = p.gens[t]
    if !isnothing(n)
        if haskey(p.gen_name_index, n); error("Name $n already defined in presentation")
        end
        p.gen_name_index[n] = t => length(gs) + 1
    end
    push!(gs, x)
    x
end

add_gens!(p::Picture, xs) = for x in xs; add_gen!(p, x) end

add_equ!(p::Picture, l::QExpr, r::QExpr) = push!(p.equations, l => r)

function add_def!(p::Picture, n::Symbol, x::QExpr)
    g = Syntax.gen_like(x, n)
    add_gen!(p, g)
    add_equ!(p, g, x)
    g
end

function associate(e::E)::E where E <: QExpr
    op, e1, e2 = head(e), first(e), last(e)
    xs1 = head(e1) == op ? args(e1) : [e1]
    xs2 = head(e2) == op ? args(e2) : [e2]
    E([xs1; xs2], gat_type_args(e))
end

function associate_unit(e::QExpr, f::Function)::QExpr
    e1, e2 = first(e), last(e)
    if (head(e1) == nameof(f)) e2
    elseif (head(e2) == nameof(f)) e1
    else associate(e) end
end

function distribute_unary(e::QExpr, unary::Function, binary::Function; unit::Union{Function,Nothing}=nothing, contra::Bool=false)::QExpr
    if (head(e) != nameof(unary)) return e end
    @assert length(args(e)) == 1
    x = first(e)
    if head(x) == nameof(binary); binary(map(unary, (contra ? reverse : identity)(args(x))))
    elseif !isnothing(unit) && head(x) == nameof(unit); x
    else e
    end
end

function involute(e::QExpr)
    @assert length(args(e)) == 1
    x = first(e)
    head(e) == head(x) ? first(x) : e
end

function to_json_sexpr(e::QExpr; by_ref::Function=x -> false)
    if head(e) == :gen && by_ref(first(e)); to_json_sexpr(first(e))
    else [string(cons_name(e)); [to_json_sexpr(x; by_ref) for x in args(e)]]
    end
end
to_json_sexpr(x::Union{Bool,Real,String,Nothing}; kw...) = x
to_json_sexpr(x; kw...) = string(x)

to_json_sexpr(p::Picture, e::QExpr) = to_json_sexpr(e; by_ref=x -> has_gen(p, x))

function invoke_term(ty::Type, instance_types::Tuple, n::Symbol, xs...)
    method = getfield(parentmodule(ty), n)
    xs = collect(Any, xs)
    if !any(typeof(x) <: typ for typ in instance_types for x in xs)
        t = GAT.theory(ty)
        i = findfirst(x -> x.name == x, t.types)
        if isnothing(i)
            cons = t.terms[findfirst(x -> x.name == x, t.terms)]
            ret = strip_type(cons.typ)
            i = findfirst(x -> x.name == ret, t.types)
        end
        insert!(xs, 1, instance_types[i])
    end
    method(xs...)
end

function invoke_term(m::Module, n::Symbol, xs...)
    ty = m.theory()
    ts = Tuple(getfield(m, x.name) for x in GAT.theory(ty).types)
    invoke_term(ty, ts, n, xs...)
end

function gen_like(e::QExpr, v)::QExpr
    invoke_term(syntax_mod(e), gat_typeof(e), v, gat_type_args(e)...)
end

function functor(ts::Tuple, e::QExpr; gens::AbstractDict=Dict(), terms::AbstractDict=Dict())
    if head(e) == :gen && haskey(gens, e); return gens[e]
    end
    n = cons_name(e)
    if haskey(terms, n); return terms[n](e)
    end
    xs = []
    for x in args(e)
        if isa(x, QExpr); x = functor(ts, x; gens, terms)
        end
        push!(xs, x)
    end
    invoke_term(syntax_mod(e).theory(), ts, n, xs...)
end

function eval_type_expr(p::Picture, m::Module, e::SyEx)
    function _eval_type_expr(x)
        @match x begin
            Expr(:curly, n, xs...) => invoke_term(m, n, map(_eval_type_expr, xs)...)
            n::Symbol => gen(p, n)
            _ => error("Invalid type expr $x")
        end
    end
    _eval_type_expr(e)
end

