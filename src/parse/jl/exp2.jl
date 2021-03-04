import ..Scan: is_assign, is_kw, is_lit, is_op
using ..Scan: Kind, QToken

is_docable(h) = h === Begin || h === ModuleH || h === BareModule || h === Quote

mutable struct Exp2
    head::Head
    args::Union{Nothing,Vector{Exp2}}
    fullspan::Int
    span::Int
    val::Union{Nothing,String}
    kind::Kind
    dot::Bool
    parent::Union{Nothing,Exp2}
    meta
end

function Exp2(h::Head, xs::Vector{Exp2}, fullspan::Int, span::Int)
    e = Exp2(h, xs, fullspan, span, nothing, NoKind, false, nothing, nothing)
    for x in xs
        setparent!(x, e)
    end
    e
end
function Exp2(h::Head, xs::Vector{Exp2})
    e = Exp2(h, xs, 0, 0)
    update_span!(e)
    e
end

err(e::Exp2) = err(e.meta)
err(x) = x
head(e::Exp2) = e.head
parent(e::Exp2) = e.parent
span(e::Exp2) = e.span
val(e::Exp2) = e.val

setparent!(c, p) = (c.parent = p; c)

is_and(e::Exp2) = is_op(e) && e.kind === Scan.AND && e.dot == false
is_anon(e::Exp2) = is_op(e) && e.kind === Scan.ANON_FUNC
is_assign(e::Exp2) = is_biny_call(e) && e.args[2].kind === Scan.EQ
is_beg_or_blk(e::Exp2) = head(e) === Begin || head(unwrap_bracket(e)) == Block
is_biny_call(e::Exp2) = head(e) === BinyOpCall
is_bracketed(e::Exp2) = head(e) === InvisBracks
is_colon(e::Exp2) = is_op(e) && e.kind === Scan.COLON
is_comma(e::Exp2) = is_punct(e) && e.kind === Scan.COMMA
is_cond(e::Exp2) = is_op(e) && e.kind === Scan.COND
is_decl_call(e::Exp2) = is_biny_call(e) && is_decl(e[2])
is_decl(e::Exp2) = is_op(e) && e.kind === Scan.DECL
is_dot(e::Exp2) = is_op(e) && e.kind === Scan.DOT
is_dot2(e::Exp2) = is_op(e) && e.kind === Scan.DOT2
is_dot3(e::Exp2) = is_op(e) && e.kind === Scan.DOT3
is_elof(e::Exp2) = is_op(e) && e.kind === Scan.ELEMENT_OF && e.dot == false
is_eq(e::Exp2) = is_op(e) && e.kind === Scan.EQ && e.dot == false
is_exor(e::Exp2) = is_op(e) && e.kind === Scan.EX_OR && e.dot == false
is_float(e::Exp2) = is_lit(e) && e.kind === Scan.FLOAT
is_getfield(e::Exp2) = is_biny_call(e) && length(e) == 3 && e[2].kind === Scan.DOT
is_id_op_interp(e::Exp2) = is_id(e) || is_op(e) || is_interp(e)
is_id(e::Exp2) = head(e) === ID || head(e) === NONSTDID
is_if(e::Exp2) = is_kw(e) && e.kind === Scan.IF
is_import(e::Exp2) = is_kw(e) && e.kind === Scan.IMPORT
is_in(e::Exp2) = is_op(e) && e.kind === Scan.IN && e.dot == false
is_int(e::Exp2) = is_lit(e) && e.kind === Scan.INTEGER
is_interp(e::Exp2) = is_uny_call(e) && is_exor(e[1])
is_issubt(e::Exp2) = is_op(e) && e.kind === Scan.ISSUBTYPE
is_issupt(e::Exp2) = is_op(e) && e.kind === Scan.ISSUPERTYPE
is_kw(e::Exp2) = head(e) === KW
is_lbrace(e::Exp2) = is_punct(e) && e.kind === Scan.LBRACE
is_lit_str(e::Exp2) = e.kind === Scan.STRING || e.kind === Scan.STRING3
is_lit(e::Exp2) = head(e) === LIT
is_lparen(e::Exp2) = is_punct(e) && e.kind === Scan.LPAREN
is_lsquare(e::Exp2) = is_punct(e) && e.kind === Scan.LSQUARE
is_maybe_call(e::Exp2) = is_some_call(e) || ((is_decl_call(e) || is_where_call(e)) && is_maybe_call(e[1]))
is_maybe_chain(e::Exp2, op::Exp2) = is_biny_call(e) && (is_star(op) || is_plus(op)) && op.kind == e.args[2].kind && !e.args[2].dot && e.args[2].span > 0
is_maybe_comp(e::Exp2) = is_biny_call(e) && (rank(e.args[2]) == CompOp || is_issubt(e.args[2]) || is_issupt(e.args[2]))
is_minus(e::Exp2) = is_op(e) && e.kind === Scan.MINUS && e.dot == false
is_no_num_juxt(e::Exp2) = is_num(e) && last(val(e)) == '.'
is_not(e::Exp2) = is_op(e) && e.kind === Scan.NOT && e.dot == false
is_nothing(e::Exp2) = is_lit(e) && e.kind === Scan.NOTHING
is_num(e::Exp2) = is_lit(e) && (e.kind === Scan.INTEGER || e.kind === Scan.FLOAT)
is_op(e::Exp2) = head(e) === OP
is_pairarrow(e::Exp2) = is_op(e) && e.kind === Scan.PAIR_ARROW && e.dot == false
is_plus(e::Exp2) = is_op(e) && e.kind === Scan.PLUS && e.dot == false
is_prime(e::Exp2) = is_op(e) && e.kind === Scan.PRIME
is_punct(e::Exp2) = head(e) === PUNCT
is_range(e::Exp2) = is_biny_call(e) && (is_eq(e.args[2]) || is_in(e.args[2]) || is_elof(e.args[2]))
is_rbrace(e::Exp2) = is_punct(e) && e.kind === Scan.RBRACE
is_rparen(e::Exp2) = is_punct(e) && e.kind === Scan.RPAREN
is_rsquare(e::Exp2) = is_punct(e) && e.kind === Scan.RSQUARE
is_sig_to_tuple(e::Exp2) = is_bracketed(e) && !(is_tuple(e.args[2]) || (head(e.args[2]) === Block) || is_splat(e.args[2]))
is_some_call(e::Exp2) = head(e) === Call || is_uny_call(e) || (is_biny_call(e) && !(e.args[2].kind === Scan.DOT || is_syntax_call(e.args[2])))
is_splat(e::Exp2) = is_uny_call(e) && is_dot3(e[2])
is_star(e::Exp2) = is_op(e) && e.kind === Scan.STAR && e.dot == false
is_str(e::Exp2) = head(e) === StringH || (is_lit(e) && (e.kind === Scan.STRING || e.kind === Scan.STRING3))
is_subt_decl(e::Exp2) = is_biny_call(e) && is_issubt(e.args[2])
is_tuple(e::Exp2) = head(e) === TupleH
is_uny_call(e::Exp2) = head(e) === UnyOpCall
is_where_call(e::Exp2) = head(e) === WhereOpCall
is_where(e::Exp2) = is_op(e) && e.kind === Scan.WHERE
is_wrapped_assign(e::Exp2) = is_assign(e) || (is_bracketed(e) && is_wrapped_assign(e.args[2]))

function is_func_call(e::Exp2)
    if head(e) === Call; true
    elseif is_where_call(e); is_func_call(e.args[1])
    elseif is_bracketed(e); is_func_call(e.args[2])
    elseif is_uny_call(e)
        !(is_op(e.args[1]) && (e.args[1].kind === Scan.EX_OR || e.args[1].kind === Scan.DECL))
    elseif is_biny_call(e)
        if is_syntax_call(e.args[2]); is_decl(e.args[2]) ? is_func_call(e.args[1]) : false
        else true
        end
    else false
    end
end

has_err(e::Exp2) = head(e) == ErrTok || (e.args !== nothing && any(has_err, e.args))
has_sig(e::Exp2) = def_datatype(e) || def_func(e) || def_macro(e) || def_anon(e)

rm_call(e::Exp2) = head(e) === Call ? e[1] : e
rm_curly(e::Exp2) = head(e) === Curly ? e.args[1] : e
rm_decl(e::Exp2) = is_decl_call(e) ? e[1] : e
rm_dot3(e::Exp2) = is_splat(e) ? e[1] : e
rm_invis(e::Exp2) = is_bracketed(e) ? rm_invis(e[2]) : e
rm_kw(e::Exp2) = head(e) === Kw ? e[1] : e
rm_subt(e::Exp2) = is_subt_decl(e) ? e[1] : e
rm_where_decl(e::Exp2) = (is_where_call(e) || is_decl_call(e)) ? e[1] : e
rm_where_subt(e::Exp2) = (is_where_call(e) || is_subt_decl(e)) ? e[1] : e
rm_where(e::Exp2) = is_where_call(e) ? e[1] : e
rm_wheres(e::Exp2) = is_where_call(e) ? rm_wheres(e[1]) : e
const rm_splat = rm_dot3

def_abstract(e::Exp2) = head(e) === Abstract
def_anon(e::Exp2) = is_biny_call(e) && is_anon(e.args[2])
def_datatype(e::Exp2) = def_struct(e) || def_abstract(e) || def_primitive(e)
def_func(e::Exp2) = head(e) === FuncDef || (is_assign(e) && is_maybe_call(e[1]))
def_macro(e::Exp2) = head(e) == Macro
def_module(e::Exp2) = head(e) === ModuleH || head(e) === BareModule
def_mutable(e::Exp2) = head(e) === Mutable
def_primitive(e::Exp2) = head(e) === Primitive
def_struct(e::Exp2) = head(e) === Struct || def_mutable(e)

adjust_span(e::Exp2) = (e.fullspan = e.span; e)
drop_leading_nl(e::Exp2) = make_lit(e.fullspan, e.span, val(e)[2:end], e.kind)
kw_expr(e::Exp2) = Exp2(Kw, Exp2[e.args[1], e.args[2], e.args[3]], e.fullspan, e.span)
unwrap_bracket(e::Exp2) = is_bracketed(e) ? unwrap_bracket(e[2]) : e

function make_uny(op::Exp2, x::Exp2)
    s = op.fullspan + x.fullspan
    e = Exp2(UnyOpCall, Exp2[op, x], s, s - x.fullspan + x.span)
    setparent!(op, e)
    setparent!(x, e)
    e
end

function make_biny(x::Exp2, op::Exp2, y::Exp2)
    s = x.fullspan + op.fullspan + y.fullspan
    e = Exp2(BinyOpCall, Exp2[x, op, y], s, s - y.fullspan + y.span)
    setparent!(x, e)
    setparent!(op, e)
    setparent!(y, e)
    e
end

function make_where(x::Exp2, op::Exp2, ys::Vector{Exp2})
    e = Exp2(WhereOpCall, Exp2[x; op; ys], x.fullspan + op.fullspan, 0)
    setparent!(x, e)
    setparent!(op, e)
    for y in ys
        e.fullspan += y.fullspan
        setparent!(y, e)
    end
    e.span = e.fullspan - last(ys).fullspan + last(ys).span
    e
end

GlobalRefDOC() = Exp2(GlobalRefDoc, Exp2[])

Base.first(e::Exp2) = e.args === nothing ? nothing : first(e.args)
Base.firstindex(e::Exp2) = 1
Base.getindex(e::Exp2, i) = e.args[i]
Base.iterate(e::Exp2, s) = s < length(e) ? (e.args[s + 1], s + 1) : nothing
Base.iterate(e::Exp2) = length(e) == 0 ? nothing : (e.args[1], 1)
Base.last(e::Exp2) = e.args === nothing ? nothing : last(e.args)
Base.lastindex(e::Exp2) = e.args === nothing ? 0 : lastindex(e.args)
Base.length(e::Exp2) = e.args isa Nothing ? 0 : length(e.args)
Base.setindex!(e::Exp2, val, i) = Base.setindex!(e.args, val, i)

function Base.push!(e::Exp2, x::Exp2)
    e.span = e.fullspan + x.span
    e.fullspan += x.fullspan
    setparent!(x, e)
    push!(e.args, x)
end

function Base.pushfirst!(e::Exp2, x::Exp2)
    e.fullspan += x.fullspan
    setparent!(x, e)
    pushfirst!(e.args, x)
end

function Base.pop!(e::Exp2)
    x = pop!(e.args)
    e.fullspan -= x.fullspan
    e.span = isempty(e.args) ? 0 : e.fullspan - last(e.args).fullspan + last(e.args).span
    x
end

function Base.append!(e::Exp2, xs::Vector{Exp2})
    append!(e.args, xs)
    for x in xs
        setparent!(x, e)
    end
    update_span!(e)
end

function Base.append!(e::Exp2, x::Exp2)
    append!(e.args, x.args)
    for a in x.args
        setparent!(a, e)
    end
    e.fullspan += x.fullspan
    e.span = e.fullspan + last(x.span)
end

function Base.show(io::IO, e::Exp2, off=0, d=0, err=false)
    T = head(e)
    c =  T === ErrTok || err ? :red : :normal
    print(io, lpad(off + 1, 3), ":", rpad(off + e.fullspan, 3), " ")
    if is_id(e)
        printstyled(io, " "^d, head(e) == NONSTDID ? val(e.args[2]) : val(e), color=:yellow)
        e.meta !== nothing && show(io, e.meta)
        println(io)
    elseif is_op(e); printstyled(io, " "^d, "OP: ", e.kind, "\n", color=c)
    elseif is_kw(e); printstyled(io, " "^d, e.kind, "\n", color=:magenta)
    elseif is_punct(e)
        if e.kind === Scan.LPAREN; printstyled(io, " "^d, "(\n", color=c)
        elseif e.kind === Scan.RPAREN; printstyled(io, " "^d, ")\n", color=c)
        elseif e.kind === Scan.LSQUARE; printstyled(io, " "^d, "[\n", color=c)
        elseif e.kind === Scan.RSQUARE; printstyled(io, " "^d, "]\n", color=c)
        elseif e.kind === Scan.COMMA; printstyled(io, " "^d, ",\n", color=c)
        else printstyled(io, " "^d, "PUNC: ", e.kind, "\n", color=c)
        end
    elseif is_lit(e); printstyled(io, " "^d, "$(e.kind): ", val(e), "\n", color=c)
    else
        printstyled(io, " "^d, T, color=c)
        if e.meta !== nothing
            print(io, "( ")
            show(io, e.meta)
            print(io, ")")
        end
        println(io)
        e.args === nothing && return
        for a in e.args
            show(io, a, off, d + 1, err)
            off += a.fullspan
        end
    end
end

function get_name(e::Exp2)
    if head(e) === Struct || head(e) === Mutable || head(e) === Abstract || head(e) === Primitive
        x = get_sig(e)
        x = rm_subt(x)
        x = rm_wheres(x)
        x = rm_subt(x)
        rm_curly(x)
    elseif head(e) === ModuleH || head(e) === BareModule; e.args[2]
    elseif head(e) === FuncDef || head(e) === Macro
        x = get_sig(e)
        x = rm_wheres(x)
        x = rm_decl(x)
        x = rm_call(x)
        x = rm_curly(x)
        x = rm_invis(x)
        if is_biny_call(x) && x.args[2].kind === Scan.DOT
            if length(x.args) > 2 && x.args[3].args isa Vector{Exp2} && length(x.args[3].args) > 0
                x = x.args[3].args[1]
            end
        end
        x
    elseif is_biny_call(e)
        length(e.args) < 2 && return e
        if e.args[2].kind === Scan.DOT
            if length(e.args) > 2 && head(e.args[3]) === Quotenode && e.args[3].args isa Vector{Exp2} && length(e.args[3].args) > 0
                return get_name(e.args[3].args[1])
            else return e
            end
        end
        x = e.args[1]
        if is_uny_call(x); return get_name(x.args[1])
        end
        x = rm_wheres(x)
        x = rm_decl(x)
        x = rm_call(x)
        x = rm_curly(x)
        x = rm_invis(x)
        get_name(x)
    else
        x = is_uny_call(e) ? e.args[1] : e
        x = rm_wheres(x)
        x = rm_decl(x)
        x = rm_call(x)
        x = rm_curly(x)
        rm_invis(x)
    end
end

function get_arg_name(e::Exp2)
    x = rm_kw(e)
    x = rm_dot3(x)
    x = rm_where(x)
    x = rm_decl(x)
    x = rm_subt(x)
    x = rm_curly(x)
    rm_invis(x)
end

function str_value(x)
    if head(x) === ID || head(x) === LIT; val(x)
    elseif is_id(x); val(x.args[2])
    elseif head(x) === OP || head(x) === MacroName; string(Expr(x))
    else ""
    end
end

function check_span(e::Exp2, neq=[])
    (is_punct(e) || is_id(e) || is_kw(e) || is_op(e) || is_lit(e) || head(e) == StringH) && return neq
    s = 0
    for x in e.args
        check_span(x, neq)
        s += x.fullspan
    end
    if length(e.args) > 0 && s != e.fullspan; push!(neq, e)
    end
    neq
end

function update_span!(e::Exp2)
    (e.args isa Nothing || isempty(e.args)) && return
    e.fullspan = 0
    for i = 1:length(e.args)
        e.fullspan += e.args[i].fullspan
    end
    e.span = e.fullspan - last(e.args).fullspan + last(e.args).span
    return
end

function get_sig(e::Exp2)
    if is_biny_call(e); e.args[1]
    elseif head(e) === Struct || head(e) === FuncDef || head(e) === Macro; e.args[2]
    elseif head(e) === Mutable || head(e) === Abstract || head(e) === Primitive; e.args[3]
    end
end

