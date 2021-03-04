function parse(s::String, cont=false)
    p = Parser(s)
    e, p = parse(p, cont)
    return e
end

function parse(p::Parser, cont=false)
    p.scanner.io.size == 0 && return (cont ? Exp2(FileH, Exp2[]) : nothing), p
    last = 0
    line = 0
    has_more(e::Exp2) = head(e) === MacroCall && head(e.args[1]) === MacroName && length(e.args[1]) == 2 && val(e.args[1].args[2]) == "doc" && length(e.args) < 3 && to_loc(p.tok)[1] + 1 <= from_loc(p.next)[1]
    if cont
        e = Exp2(FileH, Exp2[])
        if p.next.kind === Scan.WS || p.next.kind === Scan.COMMENT
            next(p)
            push!(e, make_lit(from_pos(p.next), from_pos(p.next), "", Scan.NOTHING))
        end
        pos = position(p)
        while p.next.kind !== Scan.ENDMARKER
            line = from_loc(p.next)[1]
            x = parse_doc(p)
            if has_more(x); push!(x, parse_expr(p)) end
            if line == last && head(last(e.args)) === Top
                push!(last(e.args), x)
                e.fullspan += x.fullspan
                e.span = e.fullspan - (x.fullspan - x.span)
            elseif p.ws.kind === Scan.SEMICOL_WS; push!(e, Exp2(Top, Exp2[x]))
            else push!(e, x)
            end
            last = line
            pos = loop_check(p, pos)
        end
    else
        if p.next.kind === Scan.WS || p.next.kind === Scan.COMMENT
            next(p)
            e = make_lit(from_pos(p.next), from_pos(p.next), "", Scan.NOTHING)
        elseif !(p.done || p.next.kind === Scan.ENDMARKER)
            line = from_loc(p.next)[1]
            e = parse_doc(p)
            if has_more(e); push!(e, parse_expr(p)) end
            last = from_loc(p.next)[1]
            if p.ws.kind === Scan.SEMICOL_WS
                e = Exp2(Top, Exp2[e])
                pos = position(p)
                while p.ws.kind === Scan.SEMICOL_WS && from_loc(p.next)[1] == last && p.next.kind !== Scan.ENDMARKER
                    x = parse_doc(p)
                    push!(e, x)
                    last = from_loc(p.next)[1]
                    pos = loop_check(p, pos)
                end
            end
        else e = Exp2(ErrTok, Exp2[], 0, 0)
        end
    end
    return e, p
end

function parse_doc(p::Parser)
    if (p.next.kind === Scan.STRING || p.next.kind === Scan.STRING3) && !is_empty_ws(p.nextws)
        x = make_lit(next(p))
        if p.next.kind === Scan.ENDMARKER || p.next.kind === Scan.END || to_loc(p.tok)[1] + 1 < from_loc(p.next)[1]; return x
        elseif is_biny_op(p.next) && !is_nested(p); return parse_combo(p, x)
        end
        e = parse_expr(p)
        Exp2(MacroCall, Exp2[GlobalRefDOC(), x, e])
    elseif is_next_doc_start(p)
        x = make_id(next(p))
        x = Exp2(x_Str, Exp2[x, parse_str_or_cmd(next(p), x)])
        e = parse_expr(p)
        Exp2(MacroCall, Exp2[GlobalRefDOC(), x, e])
    else parse_expr(p)
    end
end

const closers = (Scan.RPAREN, Scan.RSQUARE, Scan.RBRACE, Scan.END, Scan.ELSE, Scan.ELSEIF, Scan.CATCH, Scan.FINALLY, Scan.ENDMARKER)

function parse_expr(p::Parser)
    if p.next.kind in closers && !(p.next.kind === Scan.END && p.nest.square); e = make_err(p, make_one(next(p)), OddToken)
    else
        next(p)
        if is_kw(p.tok) && p.tok.kind !== Scan.DO; e = parse_kw(p)
        elseif p.tok.kind === Scan.LPAREN; e = parse_paren(p)
        elseif p.tok.kind === Scan.LSQUARE; e = @blank p parse_array(p)
        elseif p.tok.kind === Scan.LBRACE; e = @blank p @nest_brace p parse_braces(p)
        elseif is_inst(p.tok) || is_op(p.tok)
            e = is_sym_and_op(p.tok) ? make_id(p) : make_one(p)
            if is_colon(e) && !(is_comma(p.next) || p.ws.kind === Scan.SEMICOL_WS); e = parse_uny(p, e)
            elseif is_op(e) && rank(e) == AssignOp && e.kind !== Scan.APPROX; e = make_err(p, e, OddAssignOp)
            end
        elseif p.tok.kind === Scan.AT_SIGN; e = parse_macro(p)
        else e = make_err(p, make_one(p), OddToken)
        end
        parse_more(p, e) = !is_nested(p) ? parse_more(p, parse_combo(p, e)) : e
        e = parse_more(p, e)
    end
    e
end

function parse_combo(p::Parser, e::Exp2)
    if p.next.kind === Scan.FOR; e = parse_generator(p, e)
    elseif p.next.kind === Scan.DO; e = @blank p @nest p :block parse_do(p, e)
    elseif is_juxta_pos(p, e)
        if is_no_num_juxt(e); e = make_err(p, e, CannotJuxtapose) end
        x = make_op(0, 0, Scan.STAR, false)
        e = parse_op(p, e, x)
    elseif (head(e) === x_Str || head(e) === x_Cmd) && is_id(p.next)
        x = make_id(next(p))
        push!(e, make_lit(x.fullspan, x.span, val(p.tok, p), Scan.STRING))
    elseif (is_id(e) || is_getfield(e)) && is_empty_ws(p.ws) && is_pre_lit(p.next)
        next(p)
        x = parse_str_or_cmd(p, e)
        if x.kind === Scan.CMD || x.kind === Scan.CMD3; e = Exp2(x_Cmd, Exp2[e, x])
        else e = val(e) == "var" ? Exp2(NONSTDID, Exp2[e, x]) : Exp2(x_Str, Exp2[e, x])
        end
    elseif p.next.kind === Scan.LPAREN
        no_ws = !is_empty_ws(p.ws)
        e = @nest_paren p parse_call(p, e)
        if no_ws && !is_uny_call(e); e = make_err(p, e, OddWS) end
    elseif p.next.kind === Scan.LBRACE
        if is_empty_ws(p.ws); e = @blank p @nonest p :inwhere @nest_brace p parse_curly(p, e)
        else e = make_err(p, (@blank p @nonest p :inwhere @nest_brace p parse_curly(p, e)), OddWS)
        end
    elseif p.next.kind === Scan.LSQUARE && is_empty_ws(p.ws) && !is_op(e); e = @blank p @nonest p :block parse_ref(p, e)
    elseif is_comma(p.next); e = parse_tuple(p, e)
    elseif is_uny_op(e) && p.next.kind !== Scan.EQ; e = parse_uny(p, e)
    elseif is_op(p.next)
        x = make_op(next(p))
        e = parse_op(p, e, x)
    elseif is_uny_call(e) && is_prime(e.args[2])
        x = @nest_rank p TimesOp parse_expr(p)
        e = make_biny(e, make_op(0, 0, Scan.STAR, false), x)
    else
        p.erred = true
        x = p.next.kind in (Scan.RPAREN, Scan.RSQUARE, Scan.RBRACE) ? make_err(p, make_punct(next(p)), Unknown) : parse_expr(p)
        e = Exp2(ErrTok, Exp2[e, x])
    end
    e
end

function parse_paren(p::Parser)
    xs = Exp2[make_punct(p)]
    @nest_paren p @blank p @nonest p :inwhere parse_comma(p, xs, false, true, true)
    if length(xs) == 2 && ((p.ws.kind !== Scan.SEMICOL_WS || head(xs[2]) === Block) && head(xs[2]) !== Params)
        use_rparen(p, xs)
        Exp2(InvisBracks, xs)
    else
        use_rparen(p, xs)
        Exp2(TupleH, xs)
    end
end

function parse_block(p::Parser, es::Vector{Exp2}=Exp2[], closers=(Scan.END,), docable=false)
    pos = position(p)
    while p.next.kind ∉ closers
        if p.next.kind in closers
            if p.next.kind === Scan.ENDMARKER; break
            elseif p.next.kind === Scan.RPAREN; push!(es, make_err(p, make_one(next(p)), OddToken))
            elseif p.next.kind === Scan.RBRACE; push!(es, make_err(p, make_one(next(p)), OddToken))
            elseif p.next.kind === Scan.RSQUARE; push!(es, make_err(p, make_one(next(p)), OddToken))
            else push!(es, make_err(p, make_one(next(p)), OddToken))
            end
        else
            e = docable ? parse_doc(p) : parse_expr(p)
            push!(es, e)
        end
        pos = loop_check(p, pos)
    end
    es
end

parse_outer(p) = p.next.kind === Scan.OUTER && p.nextws.kind !== Scan.EMPTY_WS && !is_op(p.next2) ? make_one(next(p)) : nothing

function parse_iter(p::Parser, outer=parse_outer(p))
    e = @nest p :range @nest p :ws parse_expr(p)
    if !is_range(e); e = make_err(p, e, InvalidIter) end
    if outer !== nothing
        e.args[1] = setparent!(Exp2(Outer, Exp2[outer, e.args[1]]), e)
        e.fullspan += outer.fullspan
        e.span = outer.fullspan + e.span
    end
    e
end

function parse_iters(p::Parser, filter=false)
    e = parse_iter(p)
    if is_comma(p.next)
        e = Exp2(Block, Exp2[e])
        pos = position(p)
        while is_comma(p.next)
            use_comma(p, e)
            push!(e, parse_iter(p))
            pos = loop_check(p, pos)
        end
    end
    if filter; e = parse_filter(p, e) end
    e
end

function parse_filter(p::Parser, e)
    if p.next.kind === Scan.IF 
        e = head(e) === Block ? Exp2(Filter, e.args) : Exp2(Filter, Exp2[e])
        push!(e, make_kw(next(p)))
        cond = @nest p :range parse_expr(p)
        push!(e, cond)
    end
    e
end

function parse_call(p::Parser, e::Exp2, ismacro=false)
    if is_minus(e) || is_not(e)
        x = @nest p :unary @nest p :inwhere @nest_rank p PowerOp parse_expr(p)
        if is_tuple(x)
            pushfirst!(x.args, e)
            Exp2(Call, x.args)
        elseif is_where_call(x) && is_tuple(x.args[1]); make_where(Exp2(Call, Exp2[e; x.args[1].args]), x.args[2], x.args[3:end])
        else make_uny(e, x)
        end
    elseif is_and(e) || is_decl(e) || is_exor(e)
        x = @nest_rank p 20 parse_expr(p)
        if is_exor(e) && is_tuple(x) && length(x) == 3 && is_splat(x.args[2]); x = Exp2(InvisBracks, x.args)
        end
        make_uny(e, x)
    elseif is_issubt(e) || is_issupt(e)
        x = @nest_rank p PowerOp parse_expr(p)
        Exp2(Call, Exp2[e; x.args])
    else
        !ismacro && head(e) === MacroName && (ismacro = true)
        xs = Exp2[e, make_punct(next(p))]
        @nest_paren p @blank p parse_comma(p, xs, !ismacro)
        use_rparen(p, xs)
        Exp2(ismacro ? MacroCall : Call, xs)
    end
end

function parse_comma(p::Parser, es::Vector{Exp2}, kw=true, block=false, istuple=false)
    pos = position(p)
    @nonest p :inwhere @nonest p :newline @nest p :comma while !is_nested(p)
        x = parse_expr(p)
        if kw && has_kw(p, x); x = kw_expr(x) end
        push!(es, x)
        if is_comma(p.next); use_comma(p, es)
        else break
        end
        pos = loop_check(p, pos)
    end
    if istuple && length(es) > 2; block = false end
    if p.ws.kind === Scan.SEMICOL_WS
        if @nonest p :inwhere @nonest p :newline @nest p :comma @nonest p :semicol is_nested(p)
            if block && !(length(es) == 1 && is_punct(es[1])) && !(head(last(es)) === UnyOpCall && is_dot3(last(es).args[2]))
                push!(es, Exp2(Block, Exp2[pop!(es)]))
            elseif kw && p.next.kind === Scan.RPAREN
                push!(es, Exp2(Params, Exp2[], 0, 0))
            end
        else
            x = @nonest p :newline @nest p :comma @nonest p :inwhere parse_expr(p)
            if block && !(length(es) == 1 && is_punct(es[1])) && !is_splat(last(es)) && !(istuple && is_comma(p.next))
                xs = Exp2[pop!(es), x]
                pos = position(p)
                @nonest p :inwhere @nonest p :newline @nest p :comma while @nonest p :semicol !is_nested(p)
                    push!(xs, parse_expr(p))
                    pos = loop_check(p, pos)
                end
                b = Exp2(Block, xs)
                push!(es, b)
                es = b
            else parse_params(p, es, Exp2[x])
            end
        end
    end
end

function parse_params(p::Parser, es::Vector{Exp2}, xs::Vector{Exp2}=Exp2[]; kw=true)
    flag = isempty(xs)
    pos = position(p)
    @nonest p :inwhere @nonest p :newline  @nest p :comma while !flag || (@nonest p :semicol !is_nested(p))
        x = flag ? parse_expr(p) : first(xs)
        if kw && has_kw(p, x); x = kw_expr(x) end
        if flag; push!(xs, x)
        else
            pop!(xs)
            push!(xs, x)
        end
        if is_comma(p.next); use_comma(p, xs) end
        if p.ws.kind === Scan.SEMICOL_WS; parse_params(p, xs; kw) end
        pos = flag ? loop_check(p, pos) : position(p)
        flag = true
    end
    if !isempty(xs); push!(es, Exp2(Params, xs)) end
end

function parse_macro(p::Parser)
    at = make_punct(p)
    m = is_empty_ws(p.ws) ? Exp2(MacroName, Exp2[at, make_id(next(p))]) : make_err(p, make_one(next(p)), OddWS)
    if p.next.kind === Scan.DOT && is_empty_ws(p.ws)
        pos = position(p)
        while p.next.kind === Scan.DOT
            x = make_op(next(p))
            m = make_biny(m, x, Exp2(Quotenode, Exp2[make_id(next(p))]))
            pos = loop_check(p, pos)
        end
    end
    if is_comma(p.next); Exp2(MacroCall, Exp2[m], m.fullspan, m.span)
    elseif is_empty_ws(p.ws) && p.next.kind === Scan.LPAREN; parse_call(p, m, true)
    else
        xs = Exp2[m]
        flag = p.nest.insquare
        pos = position(p)
        @blank p while !is_nested(p)
            if flag; a = @nest p :insquare @nest p :inmacro @nest p :ws @nest p :wsop parse_expr(p)
            else a = @nest p :inmacro @nest p :ws @nest p :wsop parse_expr(p)
            end
            push!(xs, a)
            flag && p.next.kind === Scan.FOR && break
            pos = loop_check(p, pos)
        end
        Exp2(MacroCall, xs)
    end
end

function parse_generator(p::Parser, e::Exp2)
    e = Exp2(Generator, Exp2[e, make_kw(next(p))])
    xs = @nest_square p parse_iters(p, true)
    if head(xs) === Block; append!(e, xs)
    else push!(e, xs)
    end
    if head(e.args[1]) === Generator || head(e.args[1]) === Flatten; e = Exp2(Flatten, Exp2[e]) end
    e
end

function parse_dot(p::Parser, iscolon=false)
    es = Exp2[]
    pos = position(p)
    while p.next.kind === Scan.DOT || p.next.kind === Scan.DOT2 || p.next.kind === Scan.DOT3
        x = make_op(next(p))
        ws = x.fullspan - x.span
        if is_dot(x)
            push!(es, make_op(1 + ws, 1, Scan.DOT, false))
        elseif is_dot2(x)
            push!(es, make_op(1, 1, Scan.DOT, false))
            push!(es, make_op(1 + ws, 1, Scan.DOT, false))
        elseif is_dot3(x)
            push!(es, make_op(1, 1, Scan.DOT, false))
            push!(es, make_op(1, 1, Scan.DOT, false))
            push!(es, make_op(1 + ws, 1, Scan.DOT, false))
        end
        pos = loop_check(p, pos)
    end
    pos = position(p)
    while true
        if p.next.kind === Scan.AT_SIGN
            x = make_punct(next(p))
            push!(es, Exp2(MacroName, Exp2[x, make_one(next(p))]))
        elseif p.next.kind === Scan.LPAREN
            x = Exp2(InvisBracks, Exp2[make_punct(next(p))])
            push!(x, @nest_paren p parse_expr(p))
            use_rparen(p, x)
            push!(es, x)
        elseif p.next.kind === Scan.EX_OR
            x = @nest p :comma parse_expr(p)
            push!(es, x)
        elseif !iscolon && is_op(p.next)
            next(p)
            push!(es, make_op(from_pos(p.next) - from_pos(p.tok),  1 + to_pos(p.tok) - from_pos(p.tok), p.tok.kind, false))
        elseif is_id(p.next) && is_empty_ws(p.nextws) && (p.next2.kind === Scan.STRING || p.next2.kind === Scan.STRING3)
            push!(es, Exp2(NONSTDID, Exp2[make_one(next(p)), make_one(next(p))]))
        else push!(es, make_one(next(p)))
        end
        if p.next.kind === Scan.DOT; push!(es, make_punct(next(p)))
        elseif is_op(p.next) && (p.next.doted || p.next.kind === Scan.DOT)
            push!(es, make_punct(Scan.DOT, 1, 1))
            l = Span(p.next.loc.from, p.next.loc.to)
            p2 = Span(from_pos(p.next) + 1, to_pos(p.next))
            p.next = RawTok(p.next.kind, l, p2, p.next.err, false, p.next.suff)
        else break
        end
        pos = loop_check(p, pos)
    end
    es
end
