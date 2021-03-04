using GeneralizedGenerated: mk_function

function parse_ctxt(e::Expr)::Ctxt
    c = Ctxt()
    xs = e.head == :tuple ? e.args : [e]
    for x in xs
        n, t = @match x begin
            Expr(:(::), n::Symbol, t) => (n, parse_raw_expr(t))
            n::Symbol => (n, :Any)
            _ => throw(ParseError("Invalid ctx expr $e"))
        end
        if haskey(c, n); throw(ParseError("Name $n already defined"))
        end
        c[n] = t
    end
    c
end
function parse_ctxt(x)
  xs = map(x) do e
      @match e begin
          Expr(:(::), v::Symbol, ty::Symbol) => (v => ty)
          v::Symbol => v
          _ => error("Invalid syntax in $e of ctx")
      end
  end
  if xs isa AbstractVector{Symbol}; (xs, nothing)
  elseif xs isa AbstractVector{Pair{Symbol,Symbol}}; (first.(xs), last.(xs))
  else error("Ctxt $x mixes typed and untyped terms")
  end
end

function parse_func(e::Expr)::QFunc
    doc, e = parse_doc(e)
    h, b = @match e begin
        Expr(:(=), xs...) => xs
        Expr(:function, xs...) => xs
        _ => throw(ParseError("Invalid function definition $e"))
    end
    @match h begin
        (Expr(:(::), Expr(:call, xs...), ret) => QFunc(Expr(:call, xs...), ret, b, doc))
        (Expr(:call, xs...) => QFunc(Expr(:call, xs...), nothing, b, doc))
        _ => throw(ParseError("Invalid function header $h"))
    end
end

function parse_cons(e::Expr)::Union{TypeCons,TermCons,AxiomCons}
    doc, e = parse_doc(e)
    c, ctx = @match e begin
        Expr(:call, :<=, inner, ctx) => (inner, parse_ctxt(ctx))
        Expr(:call, :⊣, inner, ctx) => (inner, parse_ctxt(ctx))
        Expr(:comparison, l, s, r, :⊣, ctx) => (Expr(:call, s, l, r), parse_ctxt(ctx))
        Expr(:where, inner, ctx) => (inner, parse_ctxt(ctx))
        _ => (e, Ctxt())
    end
    function parse_param(x::SyEx)::Symbol
        n, t = @match x begin
            Expr(:(::), n::Symbol, t) => (n, parse_raw_expr(t))
            n::Symbol => (n, :Any)
            _ => throw(ParseError("Invalid type/term parameter $x"))
        end
        if !haskey(ctx, n); ctx[n] = t
        end
        n
    end
    @match c begin
        (Expr(:(::), n::Symbol, :TYPE) => TypeCons(n, [], ctx, doc))
        (Expr(:(::), Expr(:call, n::Symbol, xs...), :TYPE) => TypeCons(n, map(parse_param, xs), ctx, doc))
        (Expr(:(::), Expr(:call, n::Symbol, xs...), t) => TermCons(n, map(parse_param, xs), parse_raw_expr(t), ctx, doc))
        (Expr(:call, :(==), left, right) => AxiomCons(:(==), left, right, ctx, doc))
        _ => throw(ParseError("Invalid type/term constructor $c"))
    end
end

parse_sig(f::QFunc) = parse_sig(f.call)
function parse_sig(e::Expr)::QSig
    n, xs = @match e begin
        Expr(:call, n::Symbol, Expr(:parameters, kw...), xs...) => (n, xs)
        Expr(:call, n::Symbol, xs...) => (n, xs)
        _ => throw(ParseError("Invalid function signature $e"))
    end
    ts = map(xs) do x
        @match x begin
            Expr(:(::), _, t) => t
            Expr(:(::), t) => t
            _ => :Any
        end
    end
    QSig(n, ts)
end

function parse_bind(x)::Bind
    @match x begin
        Expr(:curly, s::Symbol, xs...) => Bind(s, xs)
        _ => throw(ParseError("Invalid theory binding $x"))
    end
end

function parse_head(e::Expr)::Head
    @match e begin
        # (Expr(:call, :(=>), Expr(:tuple, bs), h) => Head(parse_bind(h), map(parse_bind, bs)))
        (Expr(:(<:), h, Expr(:tuple, bs)) => Head(parse_bind(h), map(parse_bind, bs)))
        # Expr(:call, :(=>), b, h) => Head(parse_bind(h), [parse_bind(b)])
        Expr(:(<:), h, b) => Head(parse_bind(h), [parse_bind(b)])
        _ => Head(parse_bind(e))
    end
end

function parse_body(e::Expr)
    @assert e.head == :block
    aliases = Dict{Symbol,Symbol}()
    types = OrderedDict{Symbol,TypeCons}()
    terms = TermCons[]
    axioms = AxiomCons[]
    for x in strip_lines(e).args
        x = strip_lines(x)
        h = last(parse_doc(x)).head
        if h in (:(::), :call, :comparison, :where)
            c = parse_cons(x)
            if isa(c, TypeCons); haskey(types, c.name) ? throw(ParseError("Duplicate constructor $x")) : types[c.name] = c
            elseif isa(c, TermCons); push!(terms, c)
            else push!(axioms, c)
            end
        elseif h == :macrocall && x.args[1] == Symbol("@op")
            if x.args[2].head == :(:=); aliases[x.args[2].args[1]] = x.args[2].args[2]
            elseif x.args[2].head == :block
                merge!(aliases, 
                  Dict(map(strip_lines(x.args[2]).args) do x
                    x.head == :(:=) ? x.args[1] => x.args[2] : throw(ParseError("Invalid alias $x")) 
                end))
            else throw(ParseError("Invalid alias $x"))
            end
        else throw(ParseError("Invalid theory element $x"))
        end
    end
    return (collect(values(types)), terms, axioms, aliases)
end

function parse_instance(e::Expr)
    @assert e.head == :block
    fs = QFunc[]
    ss = Symbol[]
    for x in strip_lines(e).args
        x = strip_lines(x)
        h = x.head
        if h == :macrocall && x.args[1] == Symbol("@import")
            ss = @match x.args[2] begin
                s::Symbol => [ss; [s]]
                Expr(:tuple, xs...) => [ss; Symbol[xs...]]
            end
        else push!(fs, parse_func(x))
        end
    end
    return (fs, ss)
end

function parse_json(m::Module, x;
  parse_head::Function=identity,
  parse_ref::Function=x -> error("Loading terms by name is disabled"),
  parse_val::Function=identity,
  syms::Bool=true,
)
    ty = m.theory()
    t = GAT.theory(ty)
    lens = Dict(x.name => length(x.params) for x in t.types)
    function p(xs::Vector, ::Type{Val{:expr}})
        f = Symbol(parse_head(syms ? Symbol(xs[1]) : xs[1]))
        n = length(xs) - 1
        ys = map(enumerate(xs[2:end])) do (i, y)
            kind = ((i == 1 && get(lens, f, nothing) == n - 1) || y isa Union{Bool,Number,Nothing}) ? :value : :expr
            p(y, Val{kind})
        end
        invoke_term(m, f, ys...)
    end
    p(x::String, ::Type{Val{:expr}}) = parse_ref(syms ? Symbol(x) : x)
    p(x::String, ::Type{Val{:value}}) = parse_val(syms ? Symbol(x) : x)
    p(x, ::Type{Val{:value}}) = parse_val(x)
    p(x, Val{:expr})
end

function parse_json(p::Picture{Theory,Name}, m::Module, x) where {Theory,Name}
    parse_json(m, x; syms=Name == Symbol, parse_ref=x -> gen(p, x))
end

function parse_wirings(p::Picture, e::Expr)::WiringDiagram
    @match e begin
        Expr(:function, call, body) => parse_wirings(p, call, body)
        Expr(:->, call, body) => parse_wirings(p, call, body)
        _ => error("Not a function or lambda expr")
    end
end
function parse_wirings(p::Picture, call::SyEx, body::Expr)::WiringDiagram
    syntax_mod = p.syntax
    xs = @match call begin
        Expr(:call, n, xs...) => xs
        Expr(:tuple, xs...) => xs
        Expr(:(::), _...) => [call]
        _::Symbol => [call]
        _ => error("Invalid function signature: $call")
    end
    parsed_args = map(xs) do x
        @match x begin
            Expr(:(::), n::Symbol, ty::SyEx) => (n, eval_type_expr(p, syntax_mod, ty))
            _ => error("Argument $x is missing name or type")
        end
    end
    args = Symbol[ first(x) for x in parsed_args ]
    kw = make_lookup(p, syntax_mod, unique_syms(body))
    func_expr = compile_recording_expr(body, args, kwargs=sort!(collect(keys(kw))))
    func = mk_function(parentmodule(syntax_mod), func_expr)
    arg_obs = syntax_mod.Ob[ last(arg) for arg in parsed_args ]
    arg_blocks = Int[ length(to_wirings(ob)) for ob in arg_obs ]
    ins = to_wirings(otimes(arg_obs))
    diagram = WiringDiagram(ins, munit(typeof(ins)))
    v_in, v_out = input_id(diagram), output_id(diagram)
    arg_ports = [ Tuple(Port(v_in, OutputPort, i) for i in (stop - len + 1):stop)
              for (len, stop) in zip(arg_blocks, cumsum(arg_blocks)) ]
    recorder = f -> (args...) -> record_call!(diagram, f, args...)
    value = func(recorder, arg_ports...; kw...)
    out_ports = normalize((value,))
    diagram.output_ports = [port_value(diagram, first(x)) for x in out_ports]
    add_wires!(diagram, [x => Port(v_out, InputPort, i) for (i, ports) in enumerate(out_ports) for x in ports])
    substitute(diagram)
end

function parse_relations(e::Expr)
    @match e begin
        Expr(:function, h, b) => parse_relations(h, b)
        Expr(:->, h, b) => parse_relations(h, b)
        _ => error("Not a function or lambda expr")
    end
end
function parse_relations(h::Expr, b::Expr)
    b = Base.remove_linenums!(b)
    @match h begin
        Expr(:where, Expr(:tuple, xs...), Expr(:tuple, ctx...)) => make_relations(ctx, xs, b.args)
        Expr(:tuple, xs...) => make_relations(xs, xs, b.args)
        _ => error("Invalid declaration of outer ports and ctx")
    end
end

parse_vars(xs) = collect(Symbol, xs)

function parse_tensors(x::Expr, e::Expr)
    all_vars = @match x begin
        Expr(:tuple, xs...) => parse_vars(xs)
        Expr(:vect, xs...) => parse_vars(xs)
    end
    parse_tensors(e; all_vars)
end
function parse_tensors(e::Expr; all_vars=nothing)
    (outer_name, outer_vs), body = @match e begin
        Expr(:(=), outer, body) => (parse_tensor_term(outer), body)
        Expr(:(:=), outer, body) => (parse_tensor_term(outer), body)
        _ => error("Tensor expr $e must be an assignment, either = or :=")
    end
    names_and_vars = map(parse_tensor_term, @match body begin
        Expr(:call, :(*), xs...) => xs
        1 => []
        x => [x]
    end)
    used = unique!(reduce(vcat, ([[outer_vs]; last.(names_and_vars)])))
    if isnothing(all_vars); all_vars = sort!(used)
    else used ⊆ all_vars || error("One of variables $used is not declared")
    end
    d = RelationDiagram{Symbol}(length(outer_vs))
    add_junctions!(d, length(all_vars), variable=all_vars)
    set_junction!(d, ports(d, outer=true), incident(d, outer_vs, :variable), outer=true)
    for (name, vs) in names_and_vars
        box = add_box!(d, length(vs); name)
        set_junction!(d, ports(d, box), incident(d, vs, :variable))
    end
    return d
end

function parse_tensor_term(x)
    @match x begin
        Expr(:ref, n::Symbol, xs...) => (n, parse_vars(xs))
        n::Symbol => (n, Symbol[])
        _ => error("Invalid syntax in $x in tensor expr")
    end
end
