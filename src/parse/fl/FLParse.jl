module FLParse
using ..Parse
export sx, desx, codegen, @lisp_str, assign_reader_dispatch, include_lisp

mutable struct SExpr
    es
end

Base.:(==)(a::SExpr, b::SExpr) = a.es == b.es

sx(xs...) = SExpr([xs...])

desx(s::SExpr) = map(desx, s.es)
desx(d::Dict) = Dict(desx(x[1]) => desx(x[2]) for x in d)
desx(s::Set) = Set(desx(x) for x in s)
desx(x) = x

lispify(s) = isa(s, SExpr) ? "(" * join(map(lispify, s.es), " ") * ")" : "$s"

make_sexpr(xs...) = Any[xs...]

reader_table = Dict{Symbol,Function}()

assign_reader_dispatch(s, f) = reader_table[s] = f

expr         = Delayed()

read(x) = parse_one(x, expr)[1]

white_space  = p"([\s\n\r]*(?<!\\);[^\n\r$]+[\n\r\s$]*|[\s\n\r]+)"
opt_ws       = white_space | e""

booly        = p"(true|false)" > (x -> x == "true" ? true : false)
stringy      = p"(?<!\\)\".*?(?<!\\)\"" > (x -> x[2:end - 1]) # _0[2:end-1] } #r"(?<!\\)\".*?(?<!\\)"
symboly      = p"[^\d(){}#'`,@~;~\[\]^\s][^\s()#'`,@~;^{}~\[\]]*" > Symbol
macrosymy    = p"@[^\d(){}#'`,@~;~\[\]^\s][^\s()#'`,@~;^{}~\[\]]*" > Symbol

uchary       = p"\\(u[\da-fA-F]{4})" > (x -> first(unescape_string(x)))
achary       = p"\\[0-7]{3}" > (x -> unescape_string(x)[1])
chary        = p"\\." > (x -> x[2])

inty         = p"[-+]?\d+" > (x -> parse(Int, x))
floaty_dot   = p"[-+]?[0-9]*\.[0-9]+([eE][-+]?[0-9]+)?[Ff]" > (x -> parse(Float32, x[1:end - 1]))
floaty_nodot = p"[-+]?[0-9]*[0-9]+([eE][-+]?[0-9]+)?[Ff]" > (x -> parse(Float32, x[1:end - 1]))
floaty       = floaty_dot | floaty_nodot
doubley      = p"[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?[dD]" > (x -> parse(Float64, x[1:end - 1]))

sexpr        = E"(" + ~opt_ws + Repeat(expr + ~opt_ws) + E")" |> (x -> SExpr(x))
hashy        = E"#{" + ~opt_ws + Repeat(expr + ~opt_ws) + E"}" |> (x -> Set(x))
curly        = E"{" + ~opt_ws + Repeat(expr + ~opt_ws) + E"}" |> (x -> Dict(x[i] => x[i + 1] for i = 1:2:length(x)))
dispatchy    = E"#" + symboly + ~opt_ws + expr |> (x -> reader_table[x[1]](x[2]))
bracket      = E"[" + ~opt_ws + Repeat(expr + ~opt_ws) + E"]" |> (x -> SExpr(x)) # TODO: not quite right
quot         = E"'" + expr > (x -> sx(:quote, x))
quasi        = E"`" + expr > (x -> sx(:quasi, x))
tildeseq     = E"~@" + expr > (x -> sx(:splice_seq, x))
tilde        = E"~" + expr > (x -> sx(:splice, x))

expr.matcher = doubley | floaty | inty | uchary | achary | chary | stringy | booly | symboly |
               macrosymy | dispatchy | sexpr | hashy | curly | bracket |
               quot | quasi | tildeseq | tilde

top    = Repeat(~opt_ws + expr) + ~opt_ws + Eos()

function quasi_it(a::Array)
    if length(a) == 2
        if a[1] == :splice; return codegen(a[2])
        elseif a[1] == :splice_seq; return Expr(:..., codegen(a[2]))
        end
    end
    Expr(:call, make_sexpr, map(quasi_it, a)...)
end
quasi_it(s::Symbol) = Expr(:quote, s)
quasi_it(x) = x

quote_it(a::Array) = Expr(:call, make_sexpr, map(x -> quote_it(x), a)...)
quote_it(s::Symbol) = QuoteNode(s)
quote_it(x) = x

function codegen(s)
    if isa(s, Symbol)
        s
    elseif isa(s, Dict)
        coded_s = [:($(codegen(x[1])) => $(codegen(x[2]))) for x in s]
        Expr(:call, Dict, coded_s...)
    elseif isa(s, Set)
        coded_s = [codegen(x) for x in s]
        Expr(:call, Set, Expr(:vect, coded_s...))
    elseif s isa Expr && s.head == :escape
        esc(codegen(s.args[1]))
    elseif !isa(s, Array)
        s
    elseif length(s) == 0
        s
    elseif s[1] == :if
        if length(s) == 3; :($(codegen(s[2])) && $(codegen(s[3])))
        elseif length(s) == 4; :($(codegen(s[2])) ? $(codegen(s[3])) : $(codegen(s[4])))
        else throw("illegal if statement $s")
        end
    elseif s[1] == :def
        length(s) == 3 || error("Malformed def: Length of list must be == 3")
        :(global $(s[2]) = $(codegen(s[3])))
    elseif s[1] == :let
        bindings = [ :($(s[2][i]) = $(codegen(s[2][i + 1]))) for i = 1:2:length(s[2]) ]
        coded_s  = map(codegen, s[3:end])
        Expr(:let, Expr(:block, bindings...), Expr(:block, coded_s...))
    elseif s[1] == :while
        coded_s = map(codegen, s[2:end])
        Expr(:while, coded_s[1], Expr(:block, coded_s[2:end]...))
    elseif s[1] == :for
        bindings = [ :($(s[2][i]) = $(codegen(s[2][i + 1]))) for i = 1:2:length(s[2]) ]
        coded_s  = map(codegen, s[3:end])
        Expr(:for, Expr(:block, bindings...), Expr(:block, coded_s...))
    elseif s[1] == :do
        Expr(:block, map(codegen, s[2:end])...)
    elseif s[1] == :global
        Expr(:global, s[2:end]...)
    elseif s[1] == :quote
        quote_it(s[2])
    elseif s[1] == :import
        Expr(:using, [Expr(:., x) for x in s[2:end]]...)
    elseif s[1] == :splice
        throw("missplaced ~ (splice)")
    elseif s[1] == :splice_seq
        throw("missplaced ~@ (splice_seq)")
    elseif s[1] == :quasi
        quasi_it(s[2])
    elseif s[1] == :lambda || s[1] == :fn
        length(s) >= 3 || error("Malformed lambda/fn: list length must be >= 3")
        coded_s = map(codegen, s[3:end])
        Expr(:function, Expr(:tuple, s[2]...), Expr(:block, coded_s...))
    elseif s[1] == :defn
        coded_s = map(codegen, s[4:end])
        Expr(:function, Expr(:call, s[2], s[3]...), Expr(:block, coded_s...))
    elseif s[1] == :defmacro
        Expr(:macro, Expr(:call, s[2], s[3]...),
         begin
            sexpr = Expr(:block, map(codegen, s[4:end])...)
            Expr(:block, Expr(:call, codegen, sexpr))
        end)
    elseif s[1] == :defmethod
    # TODO
    else
        coded_s = map(codegen, s)
        if (typeof(coded_s[1]) == Symbol && occursin(r"^@.*$", string(coded_s[1]))) || (typeof(coded_s[1]) == Expr && occursin(r"^@.*$", string(coded_s[1].args[1])))
            Expr(:macrocall, coded_s[1], nothing, coded_s[2:end]...)
        else
            Expr(:call, coded_s[1], coded_s[2:end]...)
        end
    end
end

function lisp_eval_helper(s::AbstractString)
    s = desx(FLParse.read(s))
    codegen(s)
end

macro lisp_str(x)
    esc(lisp_eval_helper(x))
end

function include_lisp(mod::Module, filename::AbstractString)
    open(filename) do io
        include_lisp(mod, io)
    end
end

function include_lisp(mod::Module, io::IO)
    content = Base.read(io, String)
    res = nothing
    for sxpr in parse_one(content, top)
        ex = codegen(desx(sxpr))
        res = Base.eval(mod, ex)
    end
    res
end

using REPL: REPL, LineEdit
using ReplMaker

function lisp_reader(s)
    try
        read(String(take!(copy(LineEdit.buffer(s)))))
        true
    catch err
        isa(err, ParserCombinator.ParserException) || rethrow(err)
        false
    end
end

function init_repl(; prompt_text="jλ> ", prompt_color=:red, start_key=")", sticky=true)
	    ReplMaker.initrepl(lisp_eval_helper,
	                  repl=Base.active_repl,
	                  valid_input_checker=lisp_reader,
	                  prompt_text=prompt_text,
	                  prompt_color=prompt_color,
	                  start_key=start_key,
                          sticky_mode=sticky,
	                  mode_name="Lisp Mode")
end

end