function make_func(f::QFunc)::Expr
    h = isnothing(f.ret) ? f.call : Expr(:(::), f.call, f.ret)
    x = f.code
    b = isnothing(x) ? Expr(:block) : x.head == :block ? x : Expr(:block, x)
    make_doc(Expr(:function, h, b), f.doc)
end

function constructor(c::Union{TypeCons,TermCons}, t::Theory)::QFunc
    ns = c.params
    ts = [strip_type(c.ctx[x]) for x in ns]
    xs = [Expr(:(::), x, ty) for (x, ty) in zip(ns, ts)]
    ret = c isa TermCons ? strip_type(c.typ) : c.name
    e = Expr(:call, c.name, xs...)
    if !any(has_type(t, ty) for ty in ts); e = add_type_dispatch(e, ret)
    end
    QFunc(e, ret)
end

function make_type(c::TypeCons, ty::Type=Any)::Expr
    e = GlobalRef(Syntax, :QExpr)
    n = if ty == Any; e else GlobalRef(parentmodule(ty), nameof(ty)) end
    s = :(struct $(c.name){T} <: $n{T}
        args::Vector
        type_args::Vector{$e}
    end)
    make_doc(strip_lines(s, recurse=true), c.doc)
end

make_types(t::Theory, ts::Vector{Type})::Vector{Expr} = isempty(ts) ? map(make_type, t.types) : map(make_type, t.types, ts)

function make_accessors(c::TypeCons)::Vector{Expr}
    fs = []
    s = gensym(:x)
    for (i, p) in enumerate(c.params)
        e = Expr(:call, p, Expr(:(::), s, c.name))
        ret = GAT.strip_type(c.ctx[p])
        b = Expr(:ref, Expr(:(.), s, QuoteNode(:type_args)), i)
        push!(fs, make_func(QFunc(e, ret, b)))
    end
    fs
end
make_accessors(t::Theory)::Vector{Expr} = vcat(map(make_accessors, t.types)...)

function make_term(c::TermCons, t::Theory, m::Module; dispatch_type::Symbol=Symbol())::Expr
    h = GAT.constructor(c, t)
    e, ret = h.call, h.ret
    if dispatch_type == Symbol(); dispatch_type = c.name
    end
    b = Expr(:block)
    eqs = GAT.equations(c, t)
    if !isempty(eqs)
        clauses = [Expr(:call, :(==), lhs, rhs) for (lhs, rhs) in eqs]
        conj = foldr((x, y) -> Expr(:(&&), x, y), clauses)
        insert!(e.args, 2, Expr(:parameters, Expr(:kw, :strict, false)))
        push!(b.args, Expr(:if,
          Expr(:(&&), :strict, Expr(:call, :(!), conj)),
          Expr(:call, :throw,
            Expr(:call, GlobalRef(Syntax, :SyntaxDomainError),
              Expr(:quote, c.name),
              Expr(:vect, c.params...)))))
    end
    ts = make_term_params(c, t, m)
    push!(b.args, Expr(:call,
      Expr(:curly, ret, Expr(:quote, dispatch_type)),
      Expr(:vect, c.params...),
      Expr(:vect, ts...)))
    make_func(QFunc(e, ret, b))
end

make_terms(t::Theory, m::Module)::Vector{Expr} = [make_term(x, t, m) for x in t.terms]

function make_term_params(c, t::Theory, m::Module)::Vector
    e = GAT.expand_term_type(c, t)
    xs = @match e begin
        Expr(:call, n::Symbol, xs...) => xs
        _::Symbol => []
    end
    bs = Dict(x.name => GlobalRef(m, x.name) for x in t.terms)
    ps = []
    for x in xs
        x = replace_nullary(x, t)
        x = replace_syms(bs, x)
        push!(ps, x)
    end
    ps
end

function make_term_gen(c::TypeCons, t::Theory, m::Module)::Expr
    make_term(cons_for_gen(c), t, m; dispatch_type=:gen)
end

make_term_gens(t::Theory, m::Module)::Vector{Expr} = [make_term_gen(x, t, m) for x in t.types]

function cons_for_gen(c::TypeCons)::TermCons
    p = :__value__
    ps = [p; c.params]
    ctx = merge(Ctxt(p => :Any), c.ctx)
    TermCons(c.name, ps, Expr(:call, c.name, c.params...), ctx)
end

function make_theory(h, b; sig=false)
    h = parse_head(h)
    @assert all(p in h.main.params for x in h.base for p in x.params)
    @assert length(h.base) <= 1 "Multiple theory extension not supported"
    n = isempty(h.base) ? nothing : only(h.base).name
    types, terms, axioms, aliases = parse_body(b)
    if sig && length(axioms) > 0; throw(ParseError("@signature does not allow axioms")) end
    t = Theory(types, terms, axioms, aliases)
    e = :(make_code($h, $t, $(esc(n))))
    Expr(:block, 
      Expr(:call, esc(:eval), e), 
      :(Core.@__doc__ $(esc(h.main.name)))
    )
end

#function GAT.theory end

function make_code(h, t, ty)
    if !isnothing(ty)
        t′ = GAT.theory(ty)
        ps = [x.name for x in t′.types]
        bs = Dict(zip(ps, only(h.base).params))
        t′ = replace_types(bs, t′)
        t = Theory([t′.types; t.types], [t′.terms; t.terms], [t′.axioms; t.axioms], merge(t′.aliases, t.aliases))
    end
    t = replace_types(t.aliases, t)
    ns = unique!(vcat([p for x in t.types for p in x.params], [x.name for x in t.terms], collect(keys(t.aliases))))  
    Expr(:block, 
      Expr(:abstract, h.main.name),
      Expr(:(=), 
          Expr(:call, GlobalRef(GAT, :theory), Expr(:(::), Expr(:curly, :Type, h.main.name))), 
          t),
      (Expr(:function, x) for x in ns)...,
    )
end

function make_instance(ty, instance_types, fs, ss)
    code = Expr(:block)
    t = GAT.theory(ty)
    bs = Dict(zip([x.name for x in t.types], instance_types))
    bound_fns = [replace_syms(bs, x) for x in interface(t)]
    bound_fns = OrderedDict(parse_sig(x) => x for x in bound_fns)
    fs = Dict(parse_sig(x) => x for x in fs)
    for (sig, f) in bound_fns
        if sig.name in ss; continue
        elseif haskey(fs, sig); f_code = fs[sig]
        elseif !isnothing(f.code); f_code = f
        else error("Method $(f.call) not codeemented in $(nameof(mod)) instance")
        end
        push!(code.args, make_func(f_code))
    end
    code
end

function make_syntax(name::Symbol, ts::Vector{Type}, ty::Type, m::Module, fs::Vector)
    t = GAT.theory(ty)
    ref = GlobalRef(parentmodule(ty), nameof(ty))
    m = Expr(:module, true, name, Expr(:block, [
      LineNumberNode(0);
      Expr(:export, [cons.name for cons in t.types]...);
      Expr(:using, Expr(:., :., :., nameof(m))); 
      :(theory() = $ref);
      make_types(t, ts);
      make_accessors(t);
      make_term_gens(t, m);
      make_terms(t, m);]...))
    top = []
    bs = Dict{Symbol,Any}(x.name => Expr(:(.), name, QuoteNode(x.name)) for x in t.types)
    fs = Dict(parse_sig(x) => x for x in fs)
    for f in interface(t)
        sig = parse_sig(f)
        bs[:new] = Expr(:(.), name, QuoteNode(sig.name))
        if haskey(fs, sig); e = make_func(replace_syms(bs, fs[sig]))
        elseif !isnothing(f.code); e = make_func(replace_syms(bs, f))
        else
            ps = [gensym("x$i") for i in eachindex(sig.types)]
            call = Expr(:call, sig.name, [Expr(:(::), pair...) for pair in zip(ps, sig.types)]...)
            b = Expr(:call, :new, ps...)
            f_code = QFunc(call, f.ret, b)
            e = make_func(replace_syms(bs, f_code))
        end
        push!(top, e)
    end
    Expr(:toplevel, m, top...)
end

function make_lookup(p::Picture, m::Module, xs)
    t = GAT.theory(m.theory())
    ts = Set([x.name for x in t.terms])
    d = Dict{Symbol,Any}()
    for x in xs
        if has_gen(p, x); d[x] = gen(p, x)
        elseif x in ts; d[x] = (ys...) -> invoke_term(m, x, ys...)
        end
    end
    d
end

function make_relations(ctx::AbstractVector, xs::AbstractVector, b::AbstractVector)
    all_vars, all_types = parse_ctxt(ctx)
    outer_vars = parse_vars(xs)
    outer_vars ⊆ all_vars || error("One of variables $outer_vars is not declared")
    var_types = if isnothing(all_types); vars -> length(vars)
    else
        var_type_map = Dict{Symbol,Symbol}(zip(all_vars, all_types))
        vars -> getindex.(Ref(var_type_map), vars)
    end
    d = RelationDiagram{Symbol}(var_types(outer_vars))
    add_junctions!(d, var_types(all_vars), variable=all_vars)
    set_junction!(d, ports(d, outer=true), incident(d, outer_vars, :variable), outer=true)
    for e in b
        name, vars = @match e begin
            Expr(:call, n::Symbol, xs...) => (n, parse_vars(xs))
            _ => error("Invalid syntax in box definition $e")
        end
        vars ⊆ all_vars || error("One of variables $vars is not declared")
        box = add_box!(d, var_types(vars), name=name)
        set_junction!(d, ports(d, box), incident(d, vars, :variable))
    end
    return d
end
