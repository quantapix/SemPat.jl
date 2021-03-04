using Base.Meta: ParseError
import Base: first, last

normalize(::Nothing) = ()
normalize(xs::Tuple) = mapreduce(normalize, (xs, ys) -> (xs..., ys...), xs; init=())
function normalize(xs::Vector)
    xs′ = map(normalize, flatten_vec(xs))
    isempty(xs′) ? ([],) : Tuple(reduce(vcat, xs) for xs in zip(xs′...))
end
normalize(x) = ([x],)

flatten_vec(xs::Vector) = mapreduce(flatten_vec, vcat, xs; init=[])
flatten_vec(x) = [x]

unique_syms(s::Symbol) = Set([s])
unique_syms(e::Expr) = reduce(union!, map(unique_syms, e.args); init=Set{Symbol}())
unique_syms(_) = Set{Symbol}()

ref_expr(s::Symbol, xs) = isempty(xs) ? s : Expr(:ref, s, xs...)

function append_expr!(e::Expr, x)::Expr
    @assert e.head == :block
    @match x begin
        Expr(:block, xs...) => append!(e.args, xs)
        _ => push!(e.args, x)
    end
    e
end

function concat_expr(e1::Expr, e2::Expr)::Expr
    @match (e1, e2) begin
        (Expr(:block, a1...), Expr(:block, a2...)) => Expr(:block, a1..., a2...)
        (Expr(:block, a1...), _) => Expr(:block, a1..., e2)
        (_, Expr(:block, a2...)) => Expr(:block, e1, a2...)
        _ => Expr(:block, e1, e2)
    end
end

function strip_lines(e::Expr; recurse=false)::Expr
    xs = [x for x in e.args if !isa(x, LineNumberNode)]
    if recurse; xs = [isa(x, Expr) ? strip_lines(x; recurse=true) : x for x in xs]
    end
    Expr(e.head, xs...)
end

function strip_type(x)::Symbol
    @match x begin
        Expr(:call, s::Symbol, xs...) => s
        s::Symbol => s
    end
end

function replace_syms(d::AbstractDict, x)
    @match x begin
        Expr(h, xs...) => Expr(h, map(x -> replace_syms(d, x), xs)...)
        s::Symbol => get(d, s, s)
        _ => x
    end
end

function make_doc(e::Expr, s::Union{String,Nothing})::Expr
    isnothing(s) ? e : Expr(:macrocall, GlobalRef(Core, Symbol("@doc")), LineNumberNode(0), s, e)
end

function parse_doc(e::Expr)::Tuple{Union{String,Nothing},Expr}
    e = strip_lines(e)
    if e.head == :macrocall && (e.args[1] == GlobalRef(Core, Symbol("@doc")) || e.args[1] == Expr(:core, Symbol("@doc"))); (e.args[2], e.args[3])
    else (nothing, e)
    end
end

function parse_raw_expr(x)
    @match x begin
        Expr(:call, xs...) => map(parse_raw_expr, xs)
        n::Symbol => nothing
        _ => throw(ParseError("Invalid raw expr $x"))
    end
    x
end

make_return_value(xs) = isempty(xs) ? nothing : length(xs) == 1 ? first(xs) : Tuple(xs)
