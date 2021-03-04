function longest_common_prefix(prefixa, prefixb)
    maxplength = min(sizeof(prefixa), sizeof(prefixb))
    maxplength == 0 && return ""
    idx = findfirst(i -> (prefixa[i] != prefixb[i]), 1:maxplength)
    idx = idx === nothing ? maxplength : idx - 1
    prefixa[1:idx]
end

function skip_to_nl(s, i)
    while (i < sizeof(s)) && s[i] != '\n'
        i = nextind(s, i)
    end
    i > sizeof(s) ? prevind(s, i) : i
end

tostr(b::IOBuffer) = unescape(String(take!(b)))

function parse_str_or_cmd(p::Parser, prefixed=false)
    sfullspan = from_pos(p.next) - from_pos(p.tok)
    sspan = 1 + to_pos(p.tok) - from_pos(p.tok)
    istri = (p.tok.kind === Scan.STRING3) || (p.tok.kind === Scan.CMD3)
    iscmd = p.tok.kind === Scan.CMD || p.tok.kind === Scan.CMD3
    lcp = nothing
    xs = []
    function adjust_lcp(e::Exp2, last=false)
        if is_lit(e)
            push!(xs, e)
            s = val(e)
            (isempty(s) || (lcp !== nothing && isempty(lcp))) && return
            (last && s[end] == '\n') && return (lcp = "")
            i, j = 2, 1
            pos = j
            while nextind(s, j) - 1 < sizeof(s) && (lcp === nothing || !isempty(lcp))
                j = skip_to_nl(s, j)
                i = nextind(s, j)
                pos1 = j
                while nextind(s, j) - 1 < sizeof(s)
                    c = s[nextind(s, j)]
                    if c == ' ' || c == '\t'; j += 1
                    elseif c == '\n'
                        j += 1
                        i = j + 1
                    else
                        pre = s[i:j]
                        lcp = lcp === nothing ? pre : longest_common_prefix(lcp, pre)
                        break
                    end
                    if j <= pos1; throw(Meta.ParseError("Infinite loop in adjust_lcp"))
                    else pos1 = j
                    end
                end
                if j < pos; throw(Meta.ParseError("Infinite loop in adjust_lcp"))
                else pos = j
                end
            end
            if i != nextind(s, j)
                pre = s[i:j]
                lcp = lcp === nothing ? pre : longest_common_prefix(lcp, pre)
            end
        end
    end
    if prefixed != false || iscmd
        s = val(p.tok, p)
        x = istri ? s[4:prevind(s, sizeof(s), 3)] : s[2:prevind(s, sizeof(s))]
        if iscmd
            x = replace(x, "\\\\" => "\\")
            x = replace(x, "\\`" => "`")
        else
            if endswith(x, "\\\\"); x = x[1:end - 1] end
            x = replace(x, "\\\"" => "\"")
        end
        e = make_lit(sfullspan, sspan, x, p.tok.kind)
        if istri
            adjust_lcp(e)
            e = Exp2(StringH, Exp2[e], sfullspan, sspan)
        else return e
        end
    else
        e = Exp2(StringH, Exp2[], sfullspan, sspan)
        io = IOBuffer(val(p.tok, p))
        i = istri ? 3 : 1
        seek(io, i)
        b = IOBuffer()
        pos = position(io)
        while !is_eof(io)
            c = read(io, Char)
            if c == '\\'
                write(b, c)
                write(b, read(io, Char))
            elseif c == '$'
                lspan = position(b)
                x = make_lit(lspan + i, lspan + i, tostr(b), Scan.STRING)
                push!(e, x)
                istri && adjust_lcp(x)
                i = 0
                op = make_op(1, 1, Scan.EX_OR, false)
                if peek_one(io) == '('
                    skip(io, 1)
                    lp = -position(io)
                    if is_ws(peek_one(io)) || peek_one(io) === '#'; read_ws_comment(io, read_one(io)) end
                    lparen = make_punct(Scan.LPAREN, lp + position(io) + 1, 1)
                    rparen = make_punct(Scan.RPAREN, 1, 1)
                    p1 = Parser(io)
                    if p1.next.kind === Scan.RPAREN
                        x = make_uny(op, Exp2(InvisBracks, Exp2[lparen, rparen]))
                        push!(e, x)
                        skip(io, 1)
                    else
                        interp = @nest p1 :paren parse_expr(p1)
                        x = make_uny(op, Exp2(InvisBracks, Exp2[lparen, interp, rparen]))
                        push!(e, x)
                        seek(io, from_pos(p1.next) + 1)
                    end
                elseif is_ws(peek_one(io)) || peek_one(io) === '#'; push!(e, make_err(p, op, InterpTrailingWS))
                else
                    pos = position(io)
                    p1 = Parser(io)
                    next(p1)
                    if p1.tok.kind === Scan.WS; error("Odd whitespace after \$ in string")
                    else t = make_one(p1)
                    end
                    t = adjust_span(t)
                    x = make_uny(op, t)
                    push!(e, x)
                    seek(io, pos + t.fullspan)
                end
            else write(b, c)
            end
            pos = loop_check(io, pos)
        end
        lspan = position(b)
        if b.size == 0; x = make_err(p, Unknown)
        else
            s = tostr(b)
            if istri
                s = s[1:prevind(s, lastindex(s), 3)]
                x = make_lit(lspan + from_pos(p.next) - to_pos(p.tok) - 1 + i, lspan + i, s, length(e) == 0 ? Scan.STRING3 : Scan.STRING)
                adjust_lcp(x, true)
            else
                s = s[1:prevind(s, lastindex(s))]
                x = make_lit(lspan + from_pos(p.next) - to_pos(p.tok) - 1 + i, lspan + i, s, Scan.STRING)
            end
        end
        push!(e, x)
    end
    ss = (Scan.STRING, p.tok.kind)
    if istri
        if lcp !== nothing && !isempty(lcp)
            for x in xs
                for (i, a) in enumerate(e.args)
                    if x == a
                        e.args[i].val = replace(val(x), "\n$lcp" => "\n")
                        break
                    end
                end
            end
        end
        if is_lit(e.args[1]) && e.args[1].kind in ss && !isempty(val(e.args[1])) && val(e.args[1])[1] == '\n'; e.args[1] = drop_leading_nl(e.args[1]) end
    end
    if (length(e.args) == 1 && is_lit(e.args[1]) && e.args[1].kind in ss); e = e.args[1] end
    update_span!(e)
    return e
end

