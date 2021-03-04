function parse_tuple(p::Parser, e::Exp2)
    op = make_punct(next(p))
    if is_tuple(e)
        if (is_assign(p.next) && p.next.kind !== Scan.APPROX); push!(e, op)
        elseif is_nested(p); push!(e, make_err(p, op, Unknown))
        else
            x = @nest p :tuple parse_expr(p)
            if !(is_lparen(first(e.args)))
                push!(e, op)
                push!(e, x)
            else e = Exp2(TupleH, Exp2[e, op, x])
            end
        end
    else
        if (is_assign(p.next) && p.next.kind !== Scan.APPROX); e = Exp2(TupleH, Exp2[e, op])
        elseif is_nested(p); e = make_err(p, Exp2(TupleH, Exp2[e, op]), Unknown)
        else
            x = @nest p :tuple parse_expr(p)
            e = Exp2(TupleH, Exp2[e, op, x])
        end
    end
    e
end

function parse_array(p::Parser, isref=false)
    xs = Exp2[make_punct(p)]
    if p.next.kind === Scan.RSQUARE
        use_rsquare(p, xs)
        Exp2(Vect, xs)
    else
        x = @nonest p :newline @nest_square p  @nest p :insquare @nest p :ws @nest p :wsop @nest p :comma parse_expr(p)
        if isref && has_kw(p, x); x = kw_expr(x) end
        if p.next.kind === Scan.RSQUARE
            if head(x) === Generator || head(x) === Flatten
                use_rsquare(p, xs)
                if is_biny_call(x.args[1]) && is_pairarrow(x.args[1].args[2]); Exp2(DictCompreh, Exp2[xs[1], x, make_one(p)])
                else Exp2(Compreh, Exp2[xs[1], x, make_one(p)])
                end
            elseif p.ws.kind === Scan.SEMICOL_WS
                push!(xs, x)
                use_rsquare(p, xs)
                Exp2(Vcat, xs)
            else
                push!(xs, x)
                use_rsquare(p, xs)
                Exp2(Vect, xs)
            end
        elseif is_comma(p.next)
            etype = Vect
            push!(xs, x)
            use_comma(p, xs)
            @nest_square p parse_comma(p, xs, isref)
            use_rsquare(p, xs)
            Exp2(etype, xs)
        elseif p.ws.kind === Scan.NEWLINE_WS
            p.nest.inref = false
            e = Exp2(Vcat, xs)
            push!(e, x)
            pos = position(p)
            while p.next.kind !== Scan.RSQUARE && p.next.kind !== Scan.ENDMARKER
                a = @nest_square p  parse_expr(p)
                push!(e, a)
                pos = loop_check(p, pos)
            end
            use_rsquare(p, e)
            update_span!(e)
            e
        elseif p.ws.kind === Scan.WS || p.ws.kind === Scan.SEMICOL_WS
            p.nest.inref = false
            e = Exp2(Hcat, Exp2[x])
            pos = position(p)
            while p.next.kind !== Scan.RSQUARE && p.ws.kind !== Scan.NEWLINE_WS && p.ws.kind !== Scan.SEMICOL_WS && p.next.kind !== Scan.ENDMARKER
                a = @nest_square p @nest p :ws @nest p :wsop parse_expr(p)
                push!(e, a)
                pos = loop_check(p, pos)
            end
            if p.next.kind === Scan.RSQUARE && p.ws.kind !== Scan.SEMICOL_WS
                if length(e.args) == 1; e = Exp2(Vcat, e.args) end
                push!(e, make_one(next(p)))
                pushfirst!(e, xs[1])
                update_span!(e)
            else
                e = length(e.args) == 1 ? e.args[1] : Exp2(Row, e.args)
                e = Exp2(Vcat, Exp2[xs[1], e])
                pos = position(p)
                while p.next.kind !== Scan.RSQUARE && p.next.kind !== Scan.ENDMARKER
                    x = @nest_square p @nest p :ws @nest p :wsop parse_expr(p)
                    push!(e, Exp2(Row, Exp2[x]))
                    pos1 = position(p)
                    while p.next.kind !== Scan.RSQUARE && p.ws.kind !== Scan.NEWLINE_WS && p.ws.kind !== Scan.SEMICOL_WS && p.next.kind !== Scan.ENDMARKER
                        a = @nest_square p @nest p :ws @nest p :wsop parse_expr(p)
                        push!(last(e.args), a)
                        pos1 = loop_check(p, pos1)
                    end
                    if length(last(e.args).args) == 1; e.args[end] = setparent!(e.args[end].args[1], e) end
                    update_span!(e)
                    pos = loop_check(p, pos)
                end
                use_rsquare(p, e)
                update_span!(e)
            end
            e
        else
            e = Exp2(Vect, xs)
            push!(e, e)
            push!(e, use_rsquare(p))
            e
        end
    end
end

function parse_ref(p::Parser, e::Exp2)
    next(p)
    ref = @nest p :inref @nonest p :inwhere parse_array(p, true)
    if head(ref) === Vect
        xs = Exp2[e]
        for x in ref.args
            push!(xs, x)
        end
        Exp2(Ref, xs)
    elseif head(ref) === Hcat
        xss = Exp2[e]
        for x in ref.args
            push!(xss, x)
        end
        Exp2(TypedHcat, xss)
    elseif head(ref) === Vcat
        xs = Exp2[e]
        for x in ref.args
            push!(xs, x)
        end
        Exp2(TypedVcat, xs)
    else
        xs = Exp2[e]
        for x in ref.args
            push!(xs, x)
        end
        Exp2(TypedCompreh, xs)
    end
end

function parse_curly(p::Parser, e::Exp2)
    xs = Exp2[e, make_punct(next(p))]
    parse_comma(p, xs, true)
    use_rbrace(p, xs)
    Exp2(Curly, xs)
end

parse_braces(p::Parser) = @blank p @nonest p :inwhere parse_barray(p)

function parse_barray(p::Parser)
    xs = Exp2[make_punct(p)]
    if p.next.kind === Scan.RBRACE
        use_rbrace(p, xs)
        Exp2(Braces, xs)
    else
        x = @nonest p :newline @nest_brace p  @nest p :ws @nest p :wsop @nest p :comma parse_expr(p)
        if p.next.kind === Scan.RBRACE
            push!(xs, x)
            if p.ws.kind === Scan.SEMICOL_WS; push!(xs, Exp2(Params, Exp2[])) end
            use_rbrace(p, xs)
            Exp2(Braces, xs)
        elseif is_comma(p.next)
            push!(xs, x)
            use_comma(p, xs)
            @nest_brace p parse_comma(p, xs, true)
            use_rbrace(p, xs)
            Exp2(Braces, xs)
        elseif p.ws.kind === Scan.NEWLINE_WS
            e = Exp2(BracesCat, xs)
            push!(e, x)
            pos = position(p)
            while p.next.kind !== Scan.RBRACE && p.next.kind !== Scan.ENDMARKER
                a = @nest_brace p  parse_expr(p)
                push!(e, a)
                pos = loop_check(p, pos)
            end
            use_rsquare(p, e)
            update_span!(e)
            return e
        elseif p.ws.kind === Scan.WS || p.ws.kind === Scan.SEMICOL_WS
            e = Exp2(Row, Exp2[x])
            pos = position(p)
            while p.next.kind !== Scan.RBRACE && p.ws.kind !== Scan.NEWLINE_WS && p.ws.kind !== Scan.SEMICOL_WS && p.next.kind !== Scan.ENDMARKER
                a = @nest_brace p @nest p :ws @nest p :wsop parse_expr(p)
                push!(e, a)
                pos = loop_check(p, pos)
            end
            if p.next.kind === Scan.RBRACE && p.ws.kind !== Scan.SEMICOL_WS
                if length(e.args) == 1; e = Exp2(BracesCat, e.args) end
                push!(xs, e)
                push!(xs, make_one(next(p)))
                Exp2(BracesCat, xs)
            else
                e = length(e.args) == 1 ? e.args[1] : Exp2(Row, e.args)
                e = Exp2(BracesCat, Exp2[xs[1], e])
                pos = position(p)
                while p.next.kind !== Scan.RBRACE
                    p.next.kind === Scan.ENDMARKER && break
                    x = @nest_brace p @nest p :ws @nest p :wsop parse_expr(p)
                    push!(e, Exp2(Row, Exp2[x]))
                    while p.next.kind !== Scan.RBRACE && p.ws.kind !== Scan.NEWLINE_WS && p.ws.kind !== Scan.SEMICOL_WS && p.next.kind !== Scan.ENDMARKER
                        a = @nest_brace p @nest p :ws @nest p :wsop parse_expr(p)
                        push!(last(e.args), a)
                        pos = loop_check(p, pos)
                    end
                    if length(last(e.args).args) == 1; e.args[end] = setparent!(e.args[end].args[1], e) end
                    update_span!(e)
                    pos = loop_check(p, pos)
                end
                use_rbrace(p, e)
                update_span!(e)
                e
            end
        else
            e = Exp2(Braces, xs)
            push!(e, e)
            push!(e, use_rbrace(p))
            e
        end
    end
end
