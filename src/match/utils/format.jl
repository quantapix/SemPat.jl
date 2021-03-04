using Base: get

struct Discard end
const discard = Discard()

render(e, pair::Pair{Symbol,Any}) = render(e, Dict(pair))
function render(e, d::Dict{Symbol,Any})
    visit(e::Expr) = Expr(e.head, filter(x -> x !== discard, map(visit, e.args))...)
    visit(s::Symbol) = get(d, s) do; s end
    visit(::LineNumberNode) = discard
    visit(x) = x
    visit(e)
end

function format(args, template)
    dispatch(arg::Symbol) = Expr(:call, :(=>), QuoteNode(arg), arg)
    dispatch(arg::Pair) = Expr(:call, :(=>), QuoteNode(arg[1]), arg[2])
    function dispatch(arg::Expr)
        @assert arg.head == :(=)
        sym = arg.args[1]
        @assert sym isa Symbol "$sym"
        value = arg.args[2]
        Expr(:call, :(=>), QuoteNode(sym), value)
    end
    dispatch(_) = throw("Unknown argtype")
    constlist = map(dispatch, args.args)
    constlist = Expr(:vect, constlist...)
    e = Expr(:call, Dict{Symbol,Any}, constlist)
    wrap = @static (x -> Expr(:call, merge, :(Base.@locals), x))
    Expr(:call, render, template, wrap(e))
end
format(x) = Expr(:call, render, x, :(Base.@locals))

macro format(x, y)
    esc(format(x, y))
end
macro format(x)
    esc(format(x))
end


prettify(x; lines=false, alias=true) = x |> (lines ? identity : strip_lines) |> flatten |> unresolve |> resyntax |> (alias ? gensym_alias : identity)

Print = (indent = function Print_indent(p)
    function (io::IO, pre::AbstractString)
        pre = "  " * pre
        p(io, pre)
    end
end,
      line = function Print_line(io::IO, pre::AbstractString)
    println(io)
    print(io, pre)
end,
      word = function Print_word(s::AbstractString)
    function (io::IO, ::AbstractString)
        print(io, s)
    end
end,
      seq = function Print_seq(ps...)
    function (io::IO, pre::AbstractString)
        pre = pre
        for p in ps
            p(io, pre)
        end
    end
end,
      run = function Print_run(io::IO, builder)
    builder(io, "")
end)

function pretty(d::Dict{Function,Int})
    idx = d[pretty]
    function and(ps)
        rs = Any[Print.word("(")]
        for p in ps
            push!(rs, p[idx])
            push!(rs, Print.word(" && "))
        end
        pop!(rs)
        if !isempty(ps)
            push!(rs, Print.word(")"))
        end
        Print.seq(rs...)
    end
    function or(ps)
        rs = Any[Print.word("(")]
        for p in ps
            push!(rs, p[idx])
            push!(rs, Print.word(" || "))
        end
        pop!(rs)
        if !isempty(ps)
            push!(rs, Print.word(")"))
        end
        Print.seq(rs...)
    end
    literal(v) = Print.word(string(v))
    wildcard = Print.word("_")
    function decons(c::Combo, _, ps)
        Print.seq(Print.word(c.repr), Print.word("("), getindex.(ps, idx)..., Print.word(")"))
    end
    function guard(pred)
        Print.seq(Print.word("when("), Print.word(repr(pred)), Print.word(")"))
    end
    function effect(perf)
        Print.seq(Print.word("do("), Print.word(repr(perf)), Print.word(")"))
    end
    (;and, or, literal, wildcard, decons, guard, effect)
end
