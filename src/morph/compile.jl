compile(m::Module, f::HomExpr; kw...) = mk_function(m, compile_expr(f; kw...))
compile(f::HomExpr; kw...) = compile(Main, f)

function compile_expr(f::HomExpr; name::Symbol=Symbol(), args::Vector{Symbol}=Symbol[], arg_types::Vector{<:SyEx}=Symbol[])
    ins = isempty(args) ? input_exprs(ndims(dom(f)), kind=:variables) : args
    b = compile_block(f, ins)
    to_function_expr(b; name, arg_types)
end

compile_block(f::HomExpr, ins::Vector) = compile_block(f, ins, SimpleState())
function compile_block(f::HomExpr{:gen}, ins::Vector, s::CompileState)::Block
    nin, nout = ndims(dom(f)), ndims(codom(f))
    @assert length(ins) == nin
    outs = genvars(s, nout)
    l = nout == 1 ? first(outs) : Expr(:tuple, outs...)
    r = gen_expr(f, ins, s)
    Block(Expr(:(=), l, r), ins, outs)
end
function compile_block(f::HomExpr{:compose}, ins::Vector, s::CompileState)::Block
    code = Expr(:block)
    vars = ins
    for g in args(f)
        block = compile_block(g, vars, s)
        code = concat_expr(code, block.code)
        vars = block.outs
    end
    outs = vars
    Block(code, ins, outs)
end
compile_block(::HomExpr{:id}, ins::Vector, ::CompileState)::Block = Block(Expr(:block), ins, ins)
function compile_block(f::HomExpr{:otimes}, ins::Vector, s::CompileState)::Block
    code = Expr(:block)
    outs = empty(ins)
    i = 1
    for g in args(f)
        nin = ndims(dom(g))
        block = compile_block(g, ins[i:i + nin - 1], s)
        code = concat_expr(code, block.code)
        append!(outs, block.outs)
        i += nin
    end
    Block(code, ins, outs)
end
function compile_block(f::HomExpr{:braid}, ins::Vector, ::CompileState)::Block
    m = ndims(first(f))
    outs = [ins[m + 1:end]; ins[1:m]]
    Block(Expr(:block), ins, outs)
end
function compile_block(f::HomExpr{:mcopy}, ins::Vector, ::CompileState)::Block
    reps = div(ndims(codom(f)), ndims(dom(f)))
    outs = reduce(vcat, fill(ins, reps))
    Block(Expr(:block), ins, outs)
end
compile_block(::HomExpr{:delete}, ins::Vector, ::CompileState)::Block = Block(Expr(:block), ins, empty(ins))

function to_function_expr(b::Block; name::Symbol=Symbol(), arg_types::Vector{<:SyEx}=Symbol[], kw::Vector{<:SyEx}=Symbol[])
    args = b.ins
    if !isempty(arg_types)
        @assert length(args) == length(arg_types)
        args = [Expr(:(::), arg, type) for (arg, type) in zip(args, arg_types)]
    end
    if !isempty(kw)
        kw = [(kw isa Expr ? kw : Expr(:kw, kw, nothing)) for kw in kwargs]
        args = [Expr(:parameters, kw...); args]
    end
    call = name == Symbol() ? Expr(:tuple, args...) : Expr(:call, name, args...)
    return_expr = Expr(:return, length(b.outs) == 1 ? b.outs[1] : Expr(:tuple, b.outs...))
    body_expr = concat_expr(b.code, return_expr)
    Expr(:function, call, body_expr)
end

function gen_expr(f::HomExpr{:gen}, ins::Vector, ::CompileState)
    v = first(f)
    Expr(:call, v::Symbol, ins...)
end

function input_exprs(n::Int; kind::Symbol=:variables, prefix::Symbol=:x)
    if kind == :variables; [Symbol(string(prefix, i)) for i in 1:n]
    elseif kind == :array; [:($prefix[$i]) for i in 1:n]
    else error("Unknown input kind: $kind")
    end
end

genvar(s::CompileState; prefix::Symbol=:v)::Symbol = Symbol(string(prefix, s.nvars += 1))
genvars(s::CompileState, n::Int; prefix::Symbol=:v)::Vector{Symbol} = Symbol[genvar(s; prefix=prefix) for i in 1:n]

evaluate(f::HomExpr, xs...; kw...) = make_return_value(evaluate_hom(f, collect(xs); kw...))

function evaluate_hom(f::HomExpr{:gen}, xs::Vector; gens::AbstractDict=Dict(), broadcast::Bool=false)
    fun = gens[first(f)]
    y = broadcast ? fun.(xs...) : fun(xs...)
    y isa Tuple ? collect(y) : [y]
end

evaluate_hom(f::HomExpr{:compose}, xs::Vector; kw...) = foldl((ys, g) -> evaluate_hom(g, ys; kw...), args(f); init=xs)

function evaluate_hom(f::Union{HomExpr{:otimes},HomExpr{:oplus}}, xs::Vector; kw...)
    i = 1
    mapreduce(vcat, args(f); init=[]) do g
        m = ndims(dom(g))
        ys = evaluate_hom(g, xs[i:i + m - 1]; kw...)
        i += m
        ys
    end
end

evaluate_hom(::HomExpr{:id}, xs::Vector; kw...) = xs
evaluate_hom(::HomExpr{:braid}, xs::Vector; kw...) = [xs[2], xs[1]]
evaluate_hom(f::HomExpr{:mcopy}, xs::Vector; kw...) = reduce(vcat, fill(xs, ndims(codom(f)) ÷ ndims(dom(f))); init=[])
evaluate_hom(::HomExpr{:delete}, ::Vector; kw...) = []

function compile_recording_expr(body::Expr, args::Vector{Symbol}; kwargs::Vector{Symbol}=Symbol[], recorder::Symbol=Symbol("##recorder"))::Expr
    function rewrite(expr)
        @match expr begin
            Expr(:call, f, args...) =>
      Expr(:call, Expr(:call, recorder, rewrite(f)), map(rewrite, args)...)
            Expr(:curly, f, args...) =>
      Expr(:call, rewrite(f), map(rewrite, args)...)
            Expr(head, args...) => Expr(head, map(rewrite, args)...)
            _ => expr
        end
    end
    Expr(:function,
  Expr(:tuple,
    Expr(:parameters, (Expr(:kw, kw, nothing) for kw in kwargs)...),
    recorder, args...),
  rewrite(body))
end

function record_call!(diagram::WiringDiagram, f::HomExpr, args...)
    subdiagram = to_wirings(f)
    v = add_box!(diagram, subdiagram)
    ins = input_ports(subdiagram)
    arg_ports = normalize(Tuple(args))
    @assert length(arg_ports) == length(ins)
    add_wires!(diagram, [Wire(x => Port(v, InputPort, i)) for (i, ports) in enumerate(arg_ports) for x in ports])
    outs = output_ports(subdiagram)
    return_ports = [ Port(v, OutputPort, i) for i in eachindex(outs) ]
    make_return_value(return_ports)
end

function compile_tensor_expr(d::UndirectedWiringDiagram;
  assign_op::Symbol=:(=), assign_name::Symbol=:out)
    vars = j -> subpart(d, j, :variable)
    outer_vars = vars(junction(d, ports(d, outer=true), outer=true))
    terms = map(boxes(d)) do box
        ref_expr(subpart(d, box, :name), vars(junction(d, ports(d, box))))
    end
    lhs = ref_expr(assign_name, outer_vars)
    rhs = if isempty(terms); 1
    elseif length(terms) == 1; first(terms)
    else Expr(:call, :(*), terms...) end
    Expr(assign_op, lhs, rhs)
end
