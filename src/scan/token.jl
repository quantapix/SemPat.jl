is_assign(k::Kind) = begin_assigns < k < end_assigns
is_kw(k::Kind) = begin_kws < k < end_kws
is_lit(k::Kind) = begin_lit < k < end_lit
is_op(k::Kind) = begin_ops < k < end_ops

struct Span{T}
    from::T
    to::T 
end
Base.getproperty(s::Span, n::Symbol) = s === :tuple ? (s.from, s.to) : getfield(s, n)

struct Loc 
    row::Int
    col::Int 
    Loc(r=0, c=0) = new(r, c)
end
Base.getproperty(l::Loc, n::Symbol) = n === :tuple ? (l.row, l.col) : getfield(l, n)

abstract type QToken end

struct Token <: QToken
    kind::Kind
    loc::Span{Loc}
    pos::Span{Int}
    val::String
    err::TokErr
    doted::Bool
    suff::Bool
    Token(k, l, p, v, e=NO_ERR, d=false, s=false) = new(k, l, p, v, e, d, s)
end
Token() = Token(ERROR, Span(Loc(), Loc()), Span(0, 0), "", UNKNOWN)

struct RawTok <: QToken
    kind::Kind
    loc::Span{Loc}
    pos::Span{Int}
    err::TokErr
    doted::Bool
    suff::Bool
    RawTok(k, l, p, e=NO_ERR, d=false, s=false) = new(k, l, p, e, d, s)
end
RawTok() = RawTok(ERROR, Span(Loc(), Loc()), Span(0, 0), UNKNOWN)

const _empty = Token()
const _empty_raw = RawTok()
empty(::Type{Token}) = _empty
empty(::Type{RawTok}) = _empty_raw

kind(t::QToken) = is_op(t.kind) ? OP : is_kw(t.kind) ? KW : t.kind
from_loc(t::QToken) = t.loc.from.tuple
to_loc(t::QToken) = t.loc.to.tuple
from_pos(t::QToken) = t.pos.from
to_pos(t::QToken) = t.pos.to

is_assign(t::QToken) = is_assign(t.kind)
is_kw(t::QToken) = is_kw(t.kind)
is_lit(t::QToken) = is_lit(t.kind)
is_op(t::QToken) = is_op(t.kind)

function unscan(t::Token)
    k = t.kind
    if k == ID || is_lit(k) || k == COMMENT || k == WS || k == ERROR; t.val
    elseif is_kw(k); lowercase(string(k))
    elseif is_op(k)
        s = t.doted ? string(".", OP_REMAP[k]) : string(OP_REMAP[k]) 
        string(s, t.val) 
    elseif k == LPAREN; "("
    elseif k == LSQUARE; "["
    elseif k == LBRACE; "{"
    elseif k == RPAREN; ")"
    elseif k == RSQUARE; "]"
    elseif k == RBRACE; "}"
    elseif k == AT_SIGN; "@"
    elseif k == COMMA; ","
    elseif k == SEMICOL; ";"
    else ""
    end
end
unscan(t::RawTok, s::String) = String(codeunits(s)[1 .+ (t.pos.from:t.pos.to)])
function unscan(xs)
    !(eltype(xs) <: QToken) && throw(ArgumentError("expected tokens"))
    io = IOBuffer()
    for x in xs
        write(io, unscan(x))
    end
    String(take!(io))
end

function Base.show(io::IO, t::Token)
    fr, fc = from_loc(t)
    tr, tc = to_loc(t)
    s = t.kind == ENDMARKER ? "" : escape_string(unscan(t))
    print(io, rpad(string(fr, ",", fc, "-", tr, ",", tc), 17, " "))
    print(io, rpad(kind(t), 15, " "))
    print(io, "\"", s, "\"")
end

function Base.show(io::IO, t::RawTok)
    fr, fc = from_loc(t)
    tr, tc = to_loc(t)
    print(io, rpad(string(fr, ",", fc, "-", tr, ",", tc), 17, " "))
    print(io, rpad(kind(t), 15, " "))
end

Base.print(io::IO, t::Token) = print(io, unscan(t))
