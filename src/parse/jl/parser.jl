import ..Scan: peek_one
using ..Scan: Loc, Span, from_loc, to_loc, from_pos, to_pos

is_bool(t::QToken) =  Scan.TRUE ≤ t.kind ≤ Scan.FALSE
is_colon(t::QToken) =  t.kind === Scan.COLON
is_comma(t::QToken) =  t.kind === Scan.COMMA
is_empty_ws(t::QToken) = t.kind === Scan.EMPTY_WS
is_eol_ws(t::QToken) = t.kind === Scan.SEMICOL_WS || t.kind === Scan.NEWLINE_WS
is_id(t::QToken) = t.kind === Scan.ID
is_inst(t::QToken) = is_id(t) || is_lit(t) || is_bool(t) || is_kw(t)
is_nl_ws(t::QToken) = t.kind === Scan.NEWLINE_WS
is_pre_lit(t::QToken) = (t.kind === Scan.STRING || t.kind === Scan.STRING3 || t.kind === Scan.CMD || t.kind === Scan.CMD3)
is_punct(t::QToken) = is_comma(t) || t.kind === Scan.END || Scan.LSQUARE ≤ t.kind ≤ Scan.RPAREN || t.kind === Scan.AT_SIGN
is_sym_and_op(t::QToken) = t.kind === Scan.WHERE || t.kind === Scan.IN || t.kind === Scan.ISA

ws_type(t::QToken) = t.kind === Scan.EMPTY_WS ? "empty" : t.kind === Scan.NEWLINE_WS ? "ws w/ newline" : t.kind === Scan.SEMICOL_WS ? "ws w/ semicol" : "ws"

const EMPTY_WS_tok = RawTok(Scan.EMPTY_WS, Span(Loc(), Loc()), Span(-1, -1))

mutable struct Nest
    newline::Bool
    semicol::Bool
    tuple::Bool
    comma::Bool
    paren::Bool
    brace::Bool
    inmacro::Bool
    insquare::Bool
    inref::Bool
    inwhere::Bool
    square::Bool
    block::Bool
    ifop::Bool
    range::Bool
    ws::Bool
    wsop::Bool
    unary::Bool
    rank::Int
end
Nest() = Nest(true, true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, -1)

mutable struct Parser
    scanner::Scanner{Base.GenericIOBuffer{Array{UInt8,1}},RawTok}
    done::Bool
    last::RawTok
    tok::RawTok
    next::RawTok
    next2::RawTok
    lastws::RawTok
    ws::RawTok
    nextws::RawTok
    next2ws::RawTok
    nest::Nest
    erred::Bool
end
function Parser(s::Union{IO,String})
    p = Parser(scan(s, RawTok), false, RawTok(), RawTok(), RawTok(), RawTok(), RawTok(), RawTok(), RawTok(), RawTok(), Nest(), false)
    next(next(p))
end
function Parser(s::Union{IO,String}, loc::Int)
    p = Parser(s)
    prev = position(p)
    while from_pos(p.next) < loc
        next(p)
        prev = loop_check(p, prev)
    end
    p
end

val(t::QToken, p::Parser) = String(p.scanner.io.data[from_pos(t) + 1:to_pos(t) + 1])

is_juxta_pos(p::Parser, e::Exp2) = ((is_num(e) && (is_id(p.next) || p.next.kind === Scan.LPAREN || p.next.kind === Scan.CMD || p.next.kind === Scan.STRING || p.next.kind === Scan.STRING3)) ||
        ((head(e) === UnyOpCall && is_prime(e.args[2]) && is_id(p.next)) ||
        ((p.tok.kind === Scan.RPAREN || p.tok.kind === Scan.RSQUARE) && (is_id(p.next) || p.next.kind === Scan.CMD)) ||
        ((p.tok.kind === Scan.STRING || p.tok.kind === Scan.STRING3) && (p.next.kind === Scan.STRING || p.next.kind === Scan.STRING3)))) || ((p.tok.kind in (Scan.INTEGER, Scan.FLOAT) || p.tok.kind in (Scan.RPAREN, Scan.RSQUARE, Scan.RBRACE)) && is_id(p.next))
is_negate_num_lit(p::Parser, e::Exp2) = (is_plus(e) || is_minus(e)) && (p.next.kind === Scan.INTEGER || p.next.kind === Scan.FLOAT) && is_empty_ws(p.ws) && p.next2.kind !== Scan.CIRCUMFLEX_ACCENT
is_next_doc_start(p::Parser) = is_id(p.next) && val(p.next, p) == "doc" && (p.next2.kind === Scan.STRING || p.next2.kind === Scan.STRING3)

has_err(p::Parser) = p.erred
has_kw(p::Parser, e::Exp2) = !p.nest.brace && is_assign(e)

loop_check(p, prev) = position(p) <= prev ? throw(Meta.ParseError("Infinite loop at $p")) : position(p)
peek_one(p::Parser) = peek_one(p.scanner)

function Base.show(io::IO, p::Parser)
    println(io, "Parser at $(position(p.scanner.io))")
    println(io, "last  : ", p.last.kind, " ($(p.last))", "    ($(ws_type(p.lastws)))")
    println(io, "tok   : ", p.tok.kind, " ($(p.tok))", "    ($(ws_type(p.ws)))")
    println(io, "next  : ", p.next.kind, " ($(p.next))", "    ($(ws_type(p.nextws)))")
end

function Base.seek(p::Parser, x)
    seek(p.scanner, x)
    next(next(p))
end

Base.position(p::Parser) = from_pos(p.next)

function next(p::Parser)
    p.last = p.tok
    p.tok = p.next
    p.next = p.next2
    p.lastws = p.ws
    p.ws = p.nextws
    p.nextws = p.next2ws
    p.next2 = Scan.next_token(p.scanner)
    c = peek_one(p.scanner)
    p.next2ws = is_ws(c) || c == '#' || c == ';' ? scan_ws_comment(p.scanner, read_one(p.scanner)) : EMPTY_WS_tok
    p
end

make_id(p::Parser) = Exp2(ID, nothing, from_pos(p.next) - from_pos(p.tok), to_pos(p.tok) - from_pos(p.tok) + 1, val(p.tok, p), NoKind, false, nothing, nothing)

make_punct(k::Kind, fullspan::Int, span::Int) = Exp2(PUNCT, nothing, fullspan, span, nothing, k, false, nothing, nothing)
make_punct(p::Parser) = Exp2(PUNCT, nothing, from_pos(p.next) - from_pos(p.tok), to_pos(p.tok) - from_pos(p.tok) + 1, nothing, p.tok.kind, false, nothing, nothing)

make_op(fullspan::Int, span::Int, k::Kind, doted::Bool) = Exp2(OP, nothing, fullspan, span, nothing, k, doted, nothing, nothing)
make_op(p::Parser) = Exp2(OP, nothing, from_pos(p.next) - from_pos(p.tok), to_pos(p.tok) - from_pos(p.tok) + 1, p.tok.suff ? val(p.tok, p) : nothing, p.tok.kind, p.tok.doted, nothing, nothing)

make_kw(k::Kind, fullspan::Int, span::Int) = Exp2(KW, nothing, fullspan, span, nothing, k, false, nothing, nothing)
make_kw(p::Parser) = Exp2(KW, nothing, from_pos(p.next) - from_pos(p.tok), to_pos(p.tok) - from_pos(p.tok) + 1, nothing, p.tok.kind, false, nothing, nothing)

make_lit(fullspan::Int, span::Int, val::String, k::Kind) = Exp2(LIT, nothing, fullspan, span, val, k, false, nothing, nothing)
function make_lit(p::Parser)
    if p.tok.kind === Scan.STRING || p.tok.kind === Scan.STRING3 ||
        p.tok.kind === Scan.CMD || p.tok.kind === Scan.CMD3
        parse_str_or_cmd(p)
    else
        v = val(p.tok, p)
        if p.tok.kind === Scan.CHAR && length(v) > 3 && !(v[2] == '\\' && is_valid_esc(v[2:prevind(v, length(v))]))
            make_err(p, make_lit(from_pos(p.next) - from_pos(p.tok), to_pos(p.tok) - from_pos(p.tok) + 1, string(v[1:2], '\''), p.tok.kind), TooLongChar)
        else
            make_lit(from_pos(p.next) - from_pos(p.tok), to_pos(p.tok) - from_pos(p.tok) + 1, v, p.tok.kind)
        end
    end
end

true_lit() = make_lit(0, 0, "", Scan.TRUE)
false_lit() = make_lit(0, 0, "", Scan.FALSE)
nothing_lit() = make_lit(0, 0, "", Scan.NOTHING)

function make_one(p::Parser)
    if is_id(p.tok); make_id(p)
    elseif is_lit(p.tok); make_lit(p)
    elseif is_kw(p.tok); make_kw(p)
    elseif is_op(p.tok); make_op(p)
    elseif is_punct(p.tok); make_punct(p)
    elseif p.tok.kind === Scan.ERROR
        p.erred = true
        Exp2(ErrTok, nothing, from_pos(p.next) - from_pos(p.tok), to_pos(p.tok) - from_pos(p.tok) + 1, val(p.tok, p), NoKind, false, nothing, Unknown)
    else make_err(p, Unknown)
    end
end

function make_err(p::Parser, k::ErrKind)
    p.erred = true
    Exp2(ErrTok, Exp2[], 0, 0, nothing, NoKind, false, nothing, k)
end
function make_err(p::Parser, x::Exp2, k)
    p.erred = true
    e = Exp2(ErrTok, Exp2[x], x.fullspan, x.span, nothing, NoKind, false, nothing, k)
    setparent!(e[1], e)
    e
end

use_comma(p::Parser, xs) = push!(xs, use_comma(p))
use_comma(p) = is_comma(p.next) ? make_punct(next(p)) : make_err(make_punct(Scan.COMMA, 0, 0), OddToken)

use_end(p::Parser, xs) = push!(xs, use_end(p))
use_end(p::Parser) = p.next.kind === Scan.END ? make_kw(next(p)) : make_err(p, make_kw(Scan.END, 0, 0), OddToken)

use_rbrace(p::Parser, xs) = push!(xs, use_rbrace(p))
use_rbrace(p) = p.next.kind === Scan.RBRACE ? make_punct(next(p)) : make_err(p, make_punct(Scan.RBRACE, 0, 0), OddToken)

use_rparen(p::Parser, xs) = push!(xs, use_rparen(p))
use_rparen(p) = p.next.kind === Scan.RPAREN ? make_punct(next(p)) : make_err(p, make_punct(Scan.RPAREN, 0, 0), OddToken)

use_rsquare(p::Parser, xs) = push!(xs, use_rsquare(p))
use_rsquare(p) = p.next.kind === Scan.RSQUARE ? make_punct(next(p)) : make_err(p, make_punct(Scan.RSQUARE, 0, 0), OddToken)

needs_ws(x, p) = x.span == x.fullspan ? make_err(p, x, Unknown) : x
needs_no_ws(x, p) = !(p.next.kind === Scan.RPAREN || p.next.kind === Scan.RBRACE || p.next.kind === Scan.RSQUARE) && x.span != x.fullspan ? make_err(p, x, OddWS) : x

function is_nested(p::Parser)
    p.next.kind === Scan.ENDMARKER ||
  (p.nest.newline && p.ws.kind === Scan.NEWLINE_WS && !is_comma(p.tok)) ||
  (p.nest.semicol && p.ws.kind === Scan.SEMICOL_WS) ||
  (is_op(p.next) && rank(p.next) <= p.nest.rank) ||
  (p.next.kind === Scan.WHERE && p.nest.rank == LazyAndOp) ||
  (p.nest.inwhere && p.next.kind === Scan.WHERE) ||
  (p.nest.inwhere && p.nest.ws && p.tok.kind === Scan.RPAREN && is_op(p.next) && rank(p.next) < DeclOp) ||
  (p.nest.rank > WhereOp && (
      (p.next.kind === Scan.LPAREN && !(p.tok.kind === Scan.EX_OR)) ||
      p.next.kind === Scan.LBRACE ||
      p.next.kind === Scan.LSQUARE ||
      (p.next.kind === Scan.STRING && is_empty_ws(p.ws)) ||
      ((p.next.kind === Scan.RPAREN || p.next.kind === Scan.RSQUARE) && is_id(p.next))
  )) ||
  (is_comma(p.next) && p.nest.rank > 0) ||
  (p.nest.comma && is_comma(p.next)) ||
  (p.nest.tuple && (is_comma(p.next) || is_assign(p.next))) ||
  (p.next.kind === Scan.FOR && p.nest.rank > -1) ||
  (p.nest.block && p.next.kind === Scan.END) ||
  (p.nest.paren && p.next.kind === Scan.RPAREN) ||
  (p.nest.brace && p.next.kind === Scan.RBRACE) ||
  (p.nest.square && p.next.kind === Scan.RSQUARE) ||
  ((p.nest.insquare || p.nest.inmacro) && p.next.kind === Scan.APPROX && p.nextws.kind === Scan.EMPTY_WS) ||
  p.next.kind === Scan.ELSEIF ||
  p.next.kind === Scan.ELSE ||
  p.next.kind === Scan.CATCH ||
  p.next.kind === Scan.FINALLY ||
  (p.nest.ifop && is_op(p.next) && (rank(p.next) <= 0 || p.next.kind === Scan.COLON)) ||
  (p.nest.range && (p.next.kind === Scan.FOR || is_comma(p.next) || p.next.kind === Scan.IF)) ||
  (p.nest.ws && !is_empty_ws(p.ws) &&
      !is_comma(p.next) &&
      !is_comma(p.tok) &&
      !(!p.nest.inmacro && p.next.kind === Scan.FOR) &&
      !(p.next.kind === Scan.DO) &&
      !(
          (is_biny_op(p.next) && !(p.nest.wsop && is_empty_ws(p.nextws) && is_uny_op(p.next) && rank(p.next) > 7)) ||
          (is_uny_op(p.tok) && p.ws.kind === Scan.WS && p.last.kind !== JLParse.Scan.COLON)
      )) ||
  (p.nest.unary && (p.tok.kind in (Scan.INTEGER, Scan.FLOAT, Scan.RPAREN, Scan.RSQUARE, Scan.RBRACE) && is_id(p.next)))
end
