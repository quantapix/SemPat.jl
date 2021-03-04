function format_ops(f::Formatter, e)
    if head(e) === JLParse.BinaryOpCall
        if (JLParse.rank(e.args[2]) in (8, 13, 14, 16) && e.args[2].kind !== Scan.ANON_FUNC) || e.args[2].fullspan == 0
            no_space_after(e.args[1], f, f.off)
            no_space_after(e.args[2], f, f.off + e.args[1].fullspan)
        else
            one_space_after(e.args[1], f, f.off)
            one_space_after(e.args[2], f, f.off + e.args[1].fullspan)
        end
    elseif head(e) === JLParse.WhereOpCall
        one_space_after(e.args[2], f, f.off + e.args[1].fullspan)
        n = length(e.args)
        off = f.off + e.args[1].fullspan + e.args[2].fullspan
        for i = 3:n
            x = e.args[i]
            if i != n; no_space_after(x, f, off)
            end
            off += x.fullspan
        end
    elseif head(e) === JLParse.ColonOpCall
        off = f.off
        n = length(e.args)
        for (i, x) in enumerate(e.args)
            if i != n; no_space_after(x, f, off)
            end
            off += x.fullspan
        end
    elseif head(e) === JLParse.ChainOpCall || head(e) == JLParse.Comparison
        off = f.off
        n = length(e.args)
        for (i, x) in enumerate(e.args)
            if i != n; one_space_after(x, f, off)
            end
            off += x.fullspan
        end
    end
end

function format_tuples(f::Formatter, e)
    if head(e) === JLParse.TupleH
        off = f.off
        n = length(e)
        for (i, x) in enumerate(e)
            i == n && continue
            if head(x) === JLParse.PUNCT && x.kind === Scan.COMMA && !(head(e.args[i + 1]) === JLParse.PUNCT)
                one_space_after(x, f, off)
            elseif !(head(e.args[i + 1]) === JLParse.Parameters)
                no_space_after(x, f, off)
            end
            off += x.fullspan
        end
    end
end

function format_curly(f::Formatter, e)
    if head(e) === JLParse.Curly
        off = f.off
        n = length(e)
        for (i, x) in enumerate(e)
            if i != n; no_space_after(x, f, off)
            end
            off += x.fullspan
        end
    end
end

function format_calls(f::Formatter, e)
    if head(e) === JLParse.Call
        if is_same_line(f.off, f.off + e.span, f.lines)
            off = f.off + e.args[1].fullspan
            n = length(e)
            for (i, x) in enumerate(e)
                i == 1 && continue
                if head(x) === JLParse.PUNCT && x.kind === Scan.COMMA
                    one_space_after(x, f, off)
                elseif i != n && !(head(e.args[i + 1]) === JLParse.Parameters)
                    no_space_after(x, f, off)
                end
                off += x.fullspan
            end
        else
        end
    elseif head(e) === JLParse.Kw
        if f.opts.kwarg === "none"
            no_space_after(e.args[1], f, f.off)
            no_space_after(e.args[2], f, f.off + e.args[1].fullspan)
        elseif f.opts.kwarg === "single"
            only_one_space_after(e.args[1], f, f.off)
            only_one_space_after(e.args[2], f, f.off + e.args[1].fullspan)
        end
    end
end

function format_iters(f::Formatter, e)
    if head(e) === JLParse.For
        off = f.off + e.args[1].fullspan
        for x in e.args[2]
            if head(x) === JLParse.BinaryOpCall && JLParse.is_eq(x.args[2])
                off += x.args[1].fullspan
                push!(f.edits, Edit(off + 1:off + 2, "in "))
                off += x.args[2].fullspan
                off += x.args[3].fullspan
            else off += x.fullspan
            end
        end
    end
end

# TODO: move this to JLParse?
function str_value(x)
    if head(x) === JLParse.PUNCT
        x.kind == Scan.LPAREN && return "("
        x.kind == Scan.LBRACE && return "{"
        x.kind == Scan.LSQUARE && return "["
        x.kind == Scan.RPAREN && return ")"
        x.kind == Scan.RBRACE && return "}"
        x.kind == Scan.RSQUARE && return "]"
        x.kind == Scan.COMMA && return ","
        x.kind == Scan.SEMICOL && return ";"
        x.kind == Scan.AT_SIGN && return "@"
        x.kind == Scan.DOT && return "."
        ""
    elseif head(x) === JLParse.ID || head(x) === JLParse.LIT || head(x) === JLParse.OP || head(x) === JLParse.KW
        JLParse.str_value(x)
    else
        s = ""
        for a in x
            s *= str_value(a)
        end
        s
    end
end

function format_docs(f::Formatter, e)
    return
    if head(e) === JLParse.MacroCall && head(e.args[1]) === JLParse.GlobalRefDoc
        off = f.off + e.args[1].fullspan
        doc = e.args[2]
        val = str_value(doc)
        # s = escape_string(strip(val, ['\n']), "\$")
        s = strip(val, ['\n'])
        ds = string("\"\"\"\n", s, "\n", "\"\"\"\n")
        if length(ds) != doc.fullspan || s != val
            push!(f.edits, Edit(off + 1:off + doc.fullspan, ""))
            push!(f.edits, Edit(off, ds))
        end
    end
end

function format_kws(f::Formatter, e)
    if head(e) === JLParse.KW &&
        e.kind in (Scan.ABSTRACT,
                      Scan.BAREMODULE,
                      Scan.CONST,
                      Scan.DO,
                      Scan.ELSEIF,
                      Scan.EXPORT,
                      Scan.FOR,
                      Scan.FUNCTION,
                      Scan.GLOBAL,
                      Scan.IF,
                      Scan.IMPORT,
                      Scan.LOCAL,
                      Scan.MACRO,
                      Scan.MODULE,
                      Scan.MUTABLE,
                      Scan.OUTER,
                      Scan.PRIMITIVE,
                      Scan.STRUCT,
                      Scan.TYPE,
                      Scan.USING,
                      Scan.WHILE)
        only_one_space_after(e, f, f.off)
    end
end

function format_comments(f::Formatter, text)
    ts = scan(text)
    while !Scan.is_eof(ts)
        t = Scan.next_token(ts)
        if Scan.kind(t) == Scan.COMMENT
            val = Vector{UInt8}(t.val)
            if length(val) > 1 && val[2] == 0x3d
                if !(val[3] in (0x20, 0x09)); push!(f.edits, Edit(t.startbyte + 2, " "))
                end
                if length(val) > 5
                    for i = length(val) - 2:-1:3
                        if val[i] in (0x20, 0x09, 0x0a, 0x0d); continue
                        else
                            push!(f.edits, Edit(t.startbyte .+ (i + 1:length(val) - 2), " "))
                            break
                        end
                    end
                end
            elseif length(val) > 1
                t.startpos == (1, 1) && val[2] == 0x21 && continue
                if !(val[2] in (0x20, 0x09, 0x23)); push!(f.edits, Edit(t.startbyte + 1, " "))
                end
            end
        end
    end
end

function format_lineends(f::Formatter, text, x)
    n = lastindex(text)
    io = IOBuffer(reverse(text))
    while !eof(io)
        c = read(io, Char)
        if c === '\n' && !eof(io)
            Base.peek(io) == 0x0d && read(io, Char) # crlf
            i1 = i2 = position(io)
            pc = Base.peek(io)
            while !eof(io) && pc in (0x20, 0x09)
                i2 = position(io)
                pc = read(io, UInt8)
            end
            if i1 != i2 && (y = get_expr(x, n - i1); y isa JLParse.Exp2 ?
                !(y.typ == JLParse.LIT && y.kind in (Scan.STRING, Scan.TRIPLE_STRING, Scan.CMD, Scan.TRIPLE_CMD)) : true)
                push!(f.edits, Edit((n - i2) + 1:(n - i1), ""))
            end
        end
    end
end

function one_space_after(x, f, off)
    if x.fullspan == x.span; push!(f.edits, Edit(off + x.fullspan, " "))
    end
end

function no_space_after(x, f, off)
    if x.fullspan != x.span; push!(f.edits, Edit(off .+ (x.span + 1:x.fullspan), ""))
    end
end

function only_one_space_after(x, f, off)
    if x.fullspan !== x.span + 1; push!(f.edits, Edit(off .+ (x.span + 1:x.fullspan), " "))
    end
end
