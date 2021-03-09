is_allsame(xs::Vector) = any(x -> x == xs[1], xs)

is_bind(s::Symbol) = occursin(r"[^_]_(_str)?$", string(s))
is_bind(_) = false
export is_bind

is_call(e::Expr) = is_expr(e, :call)
is_call(x, f) = is_expr(x, :call) && x.args[1] == f
iscall(_) = false
export is_call

is_expr(::Expr) = true
is_expr(e::Expr, xs...) = e.head in xs
is_expr(x, xs...) = any(T -> isa(T, Type) && isa(x, T), xs)
is_expr(_) = false
export is_expr

is_gensym(s::Symbol) = occursin("#", string(s))
is_gensym(x) = false
export is_gensym

is_line(x) = is_expr(x, :line) || isa(x, LineNumberNode)
export is_line

is_slurp(s::Symbol) = s == :__ || occursin(r"[^_]__$", string(s))
is_slurp(x) = false
export is_slurp

get_funsym(e::Expr) = is_call(e) ? e.args[1] : e.head
get_funsym(e) = e

set_funsym!(e::Expr, s) = is_call(e) ? (e.args[1] = s) : (e.head = s)
set_funsym!(_, s) = s

get_funargs(e::Expr) = e.args[(is_call(e) ? 2 : 1):end]
get_funargs(_) = []

set_funargs!(e::Expr, xs::Vector) = (e.args[(is_call(e) ? 2 : 1):end] = xs)
set_funargs!(_, _2) = []

function rm_lines(e::Expr)
    f(x) = !is_line(x)
    if e.head == :macrocall && length(e.args) >= 2
        Expr(e.head, e.args[1], nothing, filter(f, e.args[3:end])...)
    else 
        Expr(e.head, filter(f, e.args)...)
    end
end
rm_lines(x) = x
export rm_lines

function rm_lines!(e::Expr)
    e.args = [rm_lines!(a) for a in e.args if !is_line(a)]
    e
end
rm_lines!(x) = x
export rm_lines!

macro esc(xs...)
    :($([:($x = esc($x)) for x in map(esc, xs)]...);)
end
export @esc

amp(x) = Expr(:&, x)
dollar(x) = Expr(:$, x)
block(xs...) = Expr(:block, xs...)

#= 
macro q(x)
    esc(Expr(:quote, rm_lines!(x)))
end
export @q =#