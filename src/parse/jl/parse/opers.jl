rank(x) = 0
rank(op::Int) = op < Scan.end_assigns ? AssignOp :
                       op < Scan.end_pairarrow ? 2 :
                       op < Scan.end_cond ? CondOp :
                       op < Scan.end_arrow ? ArrowOp :
                       op < Scan.end_lazyor ? LazyOrOp :
                       op < Scan.end_lazyand ? LazyAndOp :
                       op < Scan.end_comp ? CompOp :
                       op < Scan.end_pipe ? PipeOp :
                       op < Scan.end_colon ? ColonOp :
                       op < Scan.end_plus ? PlusOp :
                       op < Scan.end_bitshifts ? ShiftOp :
                       op < Scan.end_times ? TimesOp :
                       op < Scan.end_rational ? RationalOp :
                       op < Scan.end_power ? PowerOp :
                       op < Scan.end_decl ? DeclOp :
                       op < Scan.end_where ? WhereOp : DotOp
rank(k::Kind) = k === Scan.DOT3 ? Dot3Op :
                        k < Scan.begin_assigns ? 0 :
                        k < Scan.end_assigns ? AssignOp :
                        k < Scan.end_pairarrow ? 2 :
                       k < Scan.end_cond ? CondOp :
                       k < Scan.end_arrow ? ArrowOp :
                       k < Scan.end_lazyor ? LazyOrOp :
                       k < Scan.end_lazyand ? LazyAndOp :
                       k < Scan.end_comp ? CompOp :
                       k < Scan.end_pipe ? PipeOp :
                       k < Scan.end_colon ? ColonOp :
                       k < Scan.end_plus ? PlusOp :
                       k < Scan.end_bitshifts ? ShiftOp :
                       k < Scan.end_times ? TimesOp :
                       k < Scan.end_rational ? RationalOp :
                       k < Scan.end_power ? PowerOp :
                       k < Scan.end_decl ? DeclOp :
                       k < Scan.end_where ? WhereOp :
                       k < Scan.end_dot ? DotOp :
                       k === Scan.ANON_FUNC ? AnonOp :
                       k === Scan.PRIME ? PrimeOp : 20
rank(t::QToken) = rank(t.kind)
rank(e::Exp2) = rank(e.kind)

is_uny_op(x) = false
is_uny_op(k::Kind) = k === Scan.ISSUBTYPE ||
                    k === Scan.ISSUPERTYPE ||
                    k === Scan.PLUS ||
                    k === Scan.MINUS ||
                    k === Scan.NOT ||
                    k === Scan.APPROX ||
                    k === Scan.NOT_SIGN ||
                    k === Scan.AND ||
                    k === Scan.SQUARE_ROOT ||
                    k === Scan.CUBE_ROOT ||
                    k === Scan.QUAD_ROOT ||
                    k === Scan.DECL ||
                    k === Scan.EX_OR ||
                    k === Scan.COLON ||
                    k === Scan.STAR_OP
is_uny_op(t::QToken) = is_uny_op(t.kind)
is_uny_op(e::Exp2) = is_op(e) && is_uny_op(e.kind)

is_biny_op(x) = false
is_biny_op(k::Kind) = is_op(k) &&
                    !(k === Scan.SQUARE_ROOT ||
                    k === Scan.CUBE_ROOT ||
                    k === Scan.QUAD_ROOT ||
                    k === Scan.NOT ||
                    k === Scan.NOT_SIGN)
is_biny_op(t::QToken) = is_biny_op(t.kind)
is_biny_op(e::Exp2) = is_op(e) && is_biny_op(e.kind)
        
is_uny_biny_op(x) = false
is_uny_biny_op(k::Kind) = k === Scan.PLUS ||
                            k === Scan.MINUS ||
                            k === Scan.EX_OR ||
                            k === Scan.ISSUBTYPE ||
                            k === Scan.ISSUPERTYPE ||
                            k === Scan.AND ||
                            k === Scan.APPROX ||
                            k === Scan.DECL ||
                            k === Scan.COLON ||
                            k === Scan.STAR_OP
is_uny_biny_op(t::QToken) = is_uny_biny_op(t.kind)

function non_dotted_op(t::QToken)
    k = t.kind
    (k === Scan.COLON_EQ ||
            k === Scan.PAIR_ARROW ||
            k === Scan.EX_OR_EQ ||
            k === Scan.COND ||
            k === Scan.LAZY_OR ||
            k === Scan.LAZY_AND ||
            k === Scan.ISSUBTYPE ||
            k === Scan.ISSUPERTYPE ||
            k === Scan.LPIPE ||
            k === Scan.RPIPE ||
            k === Scan.EX_OR ||
            k === Scan.COLON ||
            k === Scan.DECL ||
            k === Scan.IN ||
            k === Scan.ISA ||
            k === Scan.WHERE ||
            (is_uny_op(k) && !is_biny_op(k) && !(k === Scan.NOT)))
end

is_syntax_call(x) = false
function is_syntax_call(e::Exp2)
    k = e.kind
    r = rank(k)
    (r == AssignOp && !(k === Scan.APPROX || k === Scan.PAIR_ARROW) || k === Scan.RIGHT_ARROW || r == LazyOrOp || r == LazyAndOp ||  k === Scan.ISSUBTYPE ||  k === Scan.ISSUPERTYPE ||  k === Scan.COLON || k === Scan.DECL || k === Scan.DOT || k === Scan.DOT3 || k === Scan.PRIME || k === Scan.WHERE || k === Scan.ANON_FUNC)
end

is_syntax_uny_call(x) = false
function is_syntax_uny_call(e::Exp2)
    k = e.kind
    (!e.dot && (k === Scan.EX_OR || k === Scan.AND || k === Scan.DECL || k === Scan.DOT3 || k === Scan.PRIME || k === Scan.ISSUBTYPE || k === Scan.ISSUPERTYPE))
end

LtoR(x::Int) = AssignOp ≤ x ≤ LazyAndOp || x == PowerOp

function parse_uny(p::Parser, e::Exp2)
    k, dot = e.kind, e.dot
    if is_colon(e); parse_colon(p, e)
    elseif is_negate_num_lit(p, e)
        x = make_lit(next(p))
        make_lit(e.fullspan + x.fullspan, (e.fullspan + x.span), string(is_plus(e) ? "+" : "-", val(p.tok, p)), p.tok.kind)
    else
        r = rank(k) == DeclOp ? DeclOp : k === Scan.AND ? DeclOp : k === Scan.EX_OR ? 20 : PowerOp
        x = @nest p :unary @nest_rank p r parse_expr(p)
        make_uny(e, x)
    end
end

function parse_colon(p::Parser, e::Exp2)
    op = needs_no_ws(e, p)
    if is_kw(p.next); Exp2(Quotenode, Exp2[op, make_id(next(p))])
    elseif is_id(p.next)
        id = make_one(next(p))
        if val(id) == "var" && is_empty_ws(p.ws) && (p.next.kind === Scan.STRING || p.next.kind === Scan.STRING3)
            x = parse_str_or_cmd(next(p), id)
            id = Exp2(NONSTDID, Exp2[id, x])
        end
        Exp2(Quotenode, Exp2[op, id])
    elseif Scan.begin_lit < p.next.kind < Scan.CHAR || is_op(p.next) || is_id(p.next) || p.next.kind === Scan.TRUE || p.next.kind === Scan.FALSE
        Exp2(Quotenode, Exp2[op, make_one(next(p))])
    elseif is_nested(p); op
    else
        prev = p.erred
        x = @nest_rank p 20 parse_expr(p)
        if is_bracketed(x)  && head(x.args[2]) === ErrTok && err(x.args[2]) === OddAssignOp
            p.erred = prev
            x.args[2] = x.args[2].args[1]
            setparent!(x.args[2], x)
        end
        Exp2(Quote, Exp2[op, x])
    end
end
function parse_colon(p::Parser, e::Exp2, op::Exp2)
    if is_nl_ws(p.ws) && !p.nest.paren; op = make_err(p, op, OddNL) end
    x = @nest_rank p ColonOp - LtoR(ColonOp) parse_expr(p)
    if is_biny_call(e) && is_colon(e.args[2]); Exp2(ColonOpCall, Exp2[e.args[1], e.args[2], e.args[3], op, x])
    else make_biny(e, op, x)
    end
end

function parse_eq(p::Parser, e::Exp2, op::Exp2)
    x = @nest_rank p AssignOp - LtoR(AssignOp) parse_expr(p)
    if is_func_call(e) && !(is_beg_or_blk(x)); x = Exp2(Block, Exp2[x]) end
    make_biny(e, op, x)
end

function parse_cond(p::Parser, e::Exp2, op::Exp2)
    e = needs_ws(e, p)
    op = needs_ws(op, p)
    x = @nest p :ifop parse_expr(p)
    op2 = p.next.kind !== Scan.COLON ? make_err(p, make_op(0, 0, Scan.COLON, false), MissingColon) : needs_ws(make_op(next(p)), p)
    x2 = @nest p :comma @nest_rank p 0 parse_expr(p)
    Exp2(CondOpCall, Exp2[e, op, x, op2, x2])
end

function parse_comp(p::Parser, e::Exp2, op::Exp2)
    x = @nest_rank p CompOp - LtoR(CompOp) parse_expr(p)
    if head(e) === Comparison
        push!(e, op)
        push!(e, x)
        e
    elseif is_maybe_comp(e); Exp2(Comparison, Exp2[e.args[1], e.args[2], e.args[3], op, x])
    else make_biny(e, op, x)
    end
end

function parse_power(p::Parser, e::Exp2, op::Exp2)
    x = @nest_rank p PowerOp - LtoR(PowerOp) @nest p :inwhere parse_expr(p)
    if is_uny_call(e)
        x = make_biny(e.args[2], op, x)
        make_uny(e.args[1], x)
    else make_biny(e, op, x)
    end
end

function parse_where(p::Parser, e::Exp2, op::Exp2, setscope=true)
    x = @nest_rank p LazyAndOp @nest p :inwhere parse_expr(p)
    xs = head(x) === Braces ? x.args : Exp2[x]
    make_where(e, op, xs)
end

function parse_dot(p::Parser, e::Exp2, op::Exp2)
    if p.next.kind === Scan.LPAREN
        err = p.ws.kind !== Scan.EMPTY_WS
        sig = @blank p parse_call(p, e)
        x = Exp2(TupleH, sig.args[2:end])
        if err; x = make_err(p, x, OddWS) end
    elseif is_kw(p.next) || is_sym_and_op(p.next); x = make_id(next(p))
    elseif p.next.kind === Scan.COLON
        op2 = make_op(next(p))
        if p.next.kind === Scan.LPAREN
            x = @nest_paren p @nest_rank p DotOp - LtoR(DotOp) parse_expr(p)
            x = Exp2(Quote, Exp2[op2, x])
        else x = @nest_rank p DotOp - LtoR(DotOp) parse_uny(p, op2)
        end
    elseif p.next.kind === Scan.EX_OR && p.next2.kind === Scan.LPAREN
        op2 = make_op(next(p))
        x = parse_call(p, op2)
    else x = @nest_rank p DotOp - LtoR(DotOp) parse_expr(p)
    end
    if is_id(x) || is_interp(x); make_biny(e, op, Exp2(Quotenode, Exp2[x]))
    elseif head(x) === Vect; make_biny(e, op, Exp2(Quote, Exp2[x]))
    elseif head(x) === MacroCall
        n = make_biny(e, op, Exp2(Quotenode, Exp2[x.args[1]]))
        e = Exp2(MacroCall, Exp2[n])
        for i = 2:length(x.args)
            push!(e, x.args[i])
        end
        e
    else make_biny(e, op, x)
    end
end

function parse_anon(p::Parser, e::Exp2, op::Exp2)
    x = @nest p :comma @nest_rank p 0 parse_expr(p)
    if !is_beg_or_blk(x); x = Exp2(Block, Exp2[x]) end
    make_biny(e, op, x)
end

function parse_op(p::Parser, e::Exp2, op::Exp2)
    k, dot = op.kind, op.dot
    r = rank(k)
    if head(e) === ChainOpCall && (is_star(op) || is_plus(op)) && op.kind == e.args[2].kind
        x = @nest_rank p r - LtoR(r) parse_expr(p)
        push!(e, op)
        push!(e, x)
        e
    elseif is_maybe_chain(e, op)
        x = @nest_rank p r - LtoR(r) parse_expr(p)
        Exp2(ChainOpCall, Exp2[e.args[1], e.args[2], e.args[3], op, x])
    elseif is_eq(op); parse_eq(p, e, op)
    elseif is_cond(op); parse_cond(p, e, op)
    elseif is_colon(op); parse_colon(p, e, op)
    elseif is_where(op); parse_where(p, e, op)
    elseif is_anon(op); parse_anon(p, e, op)
    elseif is_dot(op); parse_dot(p, e, op)
    elseif is_dot3(op) || is_prime(op); make_uny(e, op)
    elseif r == CompOp; parse_comp(p, e, op)
    elseif r == PowerOp; parse_power(p, e, op)
    else
        ltor = k === Scan.LPIPE ? true : LtoR(r)
        x = @nest_rank p r - ltor parse_expr(p)
        make_biny(e, op, x)
    end
end
