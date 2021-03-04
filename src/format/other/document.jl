# Implement Interval Tree using DataStructures's SortedDict
struct IntervalTreeOrder <: DataStructures.Ordering end
DataStructures.lt(::IntervalTreeOrder, a::UnitRange{Int}, b::UnitRange{Int}) =
    last(a) < first(b)
DataStructures.eq(::IntervalTreeOrder, a::UnitRange{Int}, b::UnitRange{Int}) =
    isequal(a, b) || first(a) in b || first(b) in a

function is_str_or_cmd(t::Tokens.Kind)
    t === Tokens.CMD && return true
    t === Tokens.TRIPLE_CMD && return true
    t === Tokens.STRING && return true
    t === Tokens.TRIPLE_STRING && return true
    return false
end

function is_str_or_cmd(typ::JLParser.Head)
    typ === JLParser.StringH && return true
    typ === JLParser.x_Str && return true
    typ === JLParser.x_Cmd && return true
    return false
end

struct Document
    text::AbstractString

    range_to_line::SortedDict{UnitRange{Int},Int,IntervalTreeOrder}
    line_to_range::Dict{Int,UnitRange{Int}}

    # mapping the off in the file to the raw literal
    # string and what lines it starts and ends at.
    lit_strings::Dict{Int,Tuple{Int,Int,String}}
    comments::Dict{Int,Tuple{Int,String}}

    # JLParser does not detect semicols.
    # It's useful to know where these are for
    # a few node types.
    semicols::Set{Int}

    # List of tuples where a tuple contains
    # the start and end lines of regions in the
    # file formatting should be skipped.
    format_skips::Vector{Tuple{Int,Int,String}}
end

function Document(text::AbstractString)
    ranges = UnitRange{Int}[]
    lit_strings = Dict{Int,Tuple{Int,Int,String}}()
    comments = Dict{Int,Tuple{Int,String}}()
    semicols = Set{Int}()
    format_skips = Tuple{Int,Int,String}[]
    prev_tok = Tokens.Token() # dummy initial token
    stack = Int[]
    format_on = true
    str = ""

    goffset = 0
    for (idx, t) in enumerate(JLParser.Tokenize.tokenize(text))
        if t.kind === Tokens.WHITESPACE
            off = goffset
            for c in t.val
                if c == '\n'
                    s = length(ranges) > 0 ? last(ranges[end]) + 1 : 1
                    push!(ranges, s:off+1)
                end
                off += 1
            end
        elseif t.kind === Tokens.ENDMARKER
            s = length(ranges) > 0 ? last(ranges[end]) + 1 : 1
            push!(ranges, s:goffset)
        elseif is_str_or_cmd(t.kind)
            off = goffset
            lit_strings[off] = (t.startpos[1], t.endpos[1], t.val)
            if t.startpos[1] != t.endpos[1]
                nls = findall(x -> x == '\n', t.val)
                bidx = 1
                cidx = 1
                for nl in nls
                    s = length(ranges) > 0 ? last(ranges[end]) + 1 : 1

                    # newline position in character length instead
                    # of byte length.
                    nl2 = cidx + length(t.val[bidx:nl]) - 1
                    # @info "" bidx cidx nl nl2
                    push!(ranges, s:off+nl2)

                    bidx = nl + 1
                    cidx = nl2 + 1
                end
            end
        elseif t.kind === Tokens.COMMENT
            ws = 0
            if prev_tok.kind === Tokens.WHITESPACE
                # Handles the case where the value of the
                # WHITESPACE token is like " \n ".
                i = findlast(c -> c == '\n', prev_tok.val)
                i === nothing && (i = 1)
                ws = count(c -> c == ' ', prev_tok.val[i:end])
            end

            if t.startpos[1] == t.endpos[1]
                # Determine the number of spaces prior to a possible inline comment
                comments[t.startpos[1]] = (ws, t.val)
            else
                # multiline comment of the form
                # #=
                #
                # #=

                line = t.startpos[1]
                off = goffset
                cs = ""
                for (i, c) in enumerate(t.val)
                    cs *= c
                    if c == '\n'
                        s = length(ranges) > 0 ? last(ranges[end]) + 1 : 1
                        push!(ranges, s:off+1)
                        fc = findfirst(c -> !isspace(c), cs)
                        idx = fc === nothing ? 1 : min(fc, ws + 1)
                        comments[line] = (ws, cs[idx:end])
                        line += 1
                        cs = ""
                    end
                    off += 1
                end
                # last comment
                idx = min(findfirst(c -> !isspace(c), cs), ws + 1)
                comments[line] = (ws, cs[idx:end])
            end

            if occursin(r"^#!\s*format\s*:\s*off\s*$", t.val) && length(stack) == 0
                # There should not be more than 1
                # "off" tag on the stack at a time.
                push!(stack, t.startpos[1])
                format_on = false
            elseif occursin(r"^#!\s*format\s*:\s*on\s*$", t.val) && length(stack) > 0
                # If "#! format: off" has not been seen
                # "#! format: on" is treated as a normal comment.
                idx1 = findfirst(c -> c == '\n', str)
                idx2 = findlast(c -> c == '\n', str)
                str = str[idx1:idx2]
                push!(format_skips, (pop!(stack), t.startpos[1], str))
                str = ""
                format_on = true
            end
        elseif t.kind === Tokens.SEMICOL
            push!(semicols, t.startpos[1])
        end
        prev_tok = t

        if t.kind === Tokens.COMMENT
            goffset += (t.endbyte - t.startbyte + 1)
        elseif t.kind === Tokens.WHITESPACE
            goffset += (t.endbyte - t.startbyte + 1)
        else
            goffset += length(Tokenize.untokenize(t))
        end

        if !format_on
            str *= Tokenize.untokenize(t)
        end
    end

    range_to_line = SortedDict{UnitRange{Int},Int}(IntervalTreeOrder())
    line_to_range = Dict{Int,UnitRange{Int}}()
    for (l, r) in enumerate(ranges)
        insert!(range_to_line, r, l)
        line_to_range[l] = r
    end

    # If there is a SINGLE "#! format: off" tag
    # do not format from the "off" tag onwards.
    if length(stack) == 1 && length(format_skips) == 0
        # -1 signifies everything afterwards "#! format: off"
        # will not formatted.
        idx1 = findfirst(c -> c == '\n', str)
        str = str[idx1:end]
        push!(format_skips, (stack[1], -1, str))
    end

    return Document(
        text,
        range_to_line,
        line_to_range,
        lit_strings,
        comments,
        semicols,
        format_skips,
    )
end
