const INDENT = 4

mutable struct IndentState
    indent::Int
    edits
end

function format_indents(f::Formatter, e)
    if head(e) === JLParse.FileH
        if e.args isa Vector{Exp2}
            for x in e.args
                check_indent(f, x)
                format_indents(f, x)
            end
        end
    elseif head(e) === JLParse.Begin || (head(e) === JLParse.Quote && head(e.args[1]) === JLParse.KW && e.args[1].kind == Scan.QUOTE)
        f.off += e.args[1].fullspan
        f.edits.indent += 1
        if e.args isa Vector{Exp2} && length(e.args) > 1 && e.args[2].args isa Vector{Exp2}
            for x in e.args[2].args
                check_indent(f, x)
                format_indents(f, x)
            end
        end
        f.edits.indent -= 1
        check_indent(f, e.args[3])
        f.off += e.args[3].fullspan
    elseif head(e) in (JLParse.FunctionDef, JLParse.Macro, JLParse.For, JLParse.While, JLParse.Struct)
        f.off += e.args[1].fullspan + e.args[2].fullspan
        if head(e.args[3]) === JLParse.Block
            f.edits.indent += 1
            if e.args[3].args isa Vector{Exp2}
                for x in e.args[3].args
                    check_indent(f, x)
                    format_indents(f, x)
                end
            end
            f.edits.indent -= 1
            check_indent(f, e.args[4])
            f.off += e.args[4].fullspan
        else
            check_indent(f, e.args[3])
            f.off += e.args[3].fullspan
        end
    elseif head(e) === JLParse.Do
        f.off += e.args[1].fullspan + e.args[2].fullspan + e.args[3].fullspan
        if head(e.args[4]) === JLParse.Block
            f.edits.indent += 1
            if e.args[4].args isa Vector{Exp2}
                for x in e.args[4].args
                    check_indent(f, x)
                    format_indents(f, x)
                end
            end
            f.edits.indent -= 1
            check_indent(f, e.args[5])
            f.off += e.args[5].fullspan
        else
            check_indent(f, e.args[4])
            f.off += e.args[4].fullspan
        end
    elseif head(e) === JLParse.MacroCall
        if head(e.args[1]) === JLParse.GlobalRefDoc
            f.off += e.args[1].fullspan
            doc = e.args[2]
            doc_strs = split(str_value(doc), "\n")
            f.off += 4
            for (i, s) in enumerate(doc_strs)
                if s == "" && i != length(doc_strs); f.off += 1
                else
                    x = JLParse.make_lit(length(s) + 1, length(s), String(s), Scan.STRING)
                    check_indent(f, x)
                    format_indents(f, x)
                end
            end
            f.off += 3
            check_indent(f, e.args[3])
            format_indents(f, e.args[3])
        else
            for x in e.args
                format_indents(f, x)
            end
        end
    elseif head(e) === JLParse.Mutable
        f.off += e.args[1].fullspan + e.args[2].fullspan + e.args[3].fullspan
        if head(e.args[4]) === JLParse.Block
            f.edits.indent += 1
            if e.args[4].args isa Vector{Exp2}
                for x in e.args[4].args
                    check_indent(f, x)
                    format_indents(f, x)
                end
            end
            f.edits.indent -= 1
            check_indent(f, e.args[5])
            f.off += e.args[5].fullspan
        else
            check_indent(f, e.args[3])
            f.off += e.args[4].fullspan
        end
    elseif head(e) === JLParse.Try
        f.off += e.args[1].fullspan
        f.edits.indent += 1
        if e.args[2].args isa Vector{Exp2}
            for x in e.args[2].args
                check_indent(f, x)
                format_indents(f, x)
            end
        end
        f.edits.indent -= 1
        check_indent(f, e.args[3])
        f.off += e.args[3].fullspan + e.args[4].fullspan
        f.edits.indent += 1
        if e.args isa Vector{Exp2} && length(e.args) >= 5 && e.args[5].args isa Vector{Exp2}
            for x in e.args[5].args
                check_indent(f, x)
                format_indents(f, x)
            end
        end
        f.edits.indent -= 1
        check_indent(f, e.args[6])
        f.off += e.args[6].fullspan
        if length(e) == 8
            f.edits.indent += 1
            if e.args[7].args isa Vector{Exp2}
                for x in e.args[7].args
                    check_indent(f, x)
                    format_indents(f, x)
                end
            end
            f.edits.indent -= 1
            check_indent(f, e.args[8])
            f.off += e.args[8].fullspan
        end
    elseif head(e) === JLParse.If
        if head(first(e.args)) === JLParse.KW && first(e.args).kind == Scan.IF
            f.off += e.args[1].fullspan + e.args[2].fullspan
            f.edits.indent += 1
            if e.args[3].args isa Vector{Exp2}
                for x in e.args[3].args
                    check_indent(f, x)
                    format_indents(f, x)
                end
            end
            f.edits.indent -= 1
            check_indent(f, e.args[4])
            f.off += e.args[4].fullspan
            if length(e.args) > 4
                f.edits.indent += 1
                if e.args[5].args isa Vector{Exp2}
                    for x in e.args[5].args
                        check_indent(f, x)
                        format_indents(f, x)
                    end
                end
                f.edits.indent -= 1
                check_indent(f, e.args[6])
                f.off += e.args[6].fullspan
            end
        else
            f.off += e.args[1].fullspan
            if e.args[2].args isa Vector{Exp2}
                for x in e.args[2].args
                    check_indent(f, x)
                    format_indents(f, x)
                end
            end
            if length(e.args) > 2
                f.edits.indent -= 1
                check_indent(f, e.args[3])
                f.off += e.args[3].fullspan
                f.edits.indent += 1
                if e.args[4].args isa Vector{Exp2}
                    for x in e.args[4].args
                        check_indent(f, x)
                        format_indents(f, x)
                    end
                end
            end
        end
    elseif head(e) === JLParse.Let
        if length(e.args) > 3
            f.off += e.args[1].fullspan + e.args[2].fullspan
            f.edits.indent += 1
            if e.args[3].args isa Vector{Exp2}
                for x in e.args[3].args
                    check_indent(f, x)
                    format_indents(f, x)
                end
            end
            f.edits.indent -= 1
            check_indent(f, e.args[4])
            f.off += e.args[4].fullspan
        else
            f.off += e.args[1].fullspan
            f.edits.indent += 1
            if e.args[2].args isa Vector{Exp2}
                for x in e.args[2].args
                    check_indent(f, x)
                    format_indents(f, x)
                end
            end
            f.edits.indent -= 1
            check_indent(f, e.args[3])
            f.off += e.args[3].fullspan
        end
    elseif head(e) in (JLParse.ID, JLParse.OP, JLParse.KW, JLParse.PUNCT, JLParse.LIT)
        f.off += e.fullspan
    else
        if e.args isa Vector{Exp2}
            for x in e.args
                format_indents(f, x)
            end
        end
    end
    f
end

function check_indent(f::Formatter, _)
    for (l, i) in f.lines
        if f.off == l + i
            if f.edits.indent * INDENT != i
                #= @info JLParse.str_value(JLParse.get_name(x)), state.edits.indent*INDENT, i, state.off =#
                push!(f.edits.edits, (l, f.edits.indent * INDENT - i))
            end
        end
    end
end

function indents(s, o::Opts)
    e = JLParse.parse(s, true)
    f = format_indents(Formatter(0, IndentState(0, []), o, s, get_lines(s)), e)
    sort!(f.edits.edits, lt=(a, b) -> a[1] < b[1], rev=true)
    for (l, d) in f.edits.edits
        s = d > 0 ? string(s[1:l], " "^d, s[l + 1:end]) : string(text[1:l], text[l + 1 - d:end])
    end
    return s
end
