function read_indent(io)
    i = 0
    while !eof(io) && (p = Base.peek(io); p == 0x20 || p == 0x09)
        p == 0x20 && (i += 1)
        p == 0x09 && (i += 4)
        read(io, UInt8)
    end
    i
end

function get_lines(s::String)
    io = IOBuffer(s)
    ls = Tuple{Int,Int}[(0, read_indent(io))]
    while !eof(io)
        c = read(io, Char)
        if c == '\r' && Base.peek(io) == 0x0a
            c = read(io, Char)
            push!(ls, (position(io), read_indent(io)))
        elseif c == '\n'; push!(ls, (position(io), read_indent(io)))
        end
    end
    first(last(ls)) != lastindex(s) && push!(ls, (lastindex(s), 0))
    ls
end

function line_of(off, ls)
    off > first(last(ls)) && error()
    off == 0 && return 1
    for i = 1:length(ls) - 1
        if ls[i][1] < off <= ls[i + 1][1]; return i
        end
    end
    return length(ls)
end

is_same_line(o1, o2, ls) = line_of(o1, ls) == line_of(o2, ls)

function get_expr(x, off, pos=0)
    if pos > off; nothing
    end
    if x.args isa Vector{Exp2}
        for a in x.args
            if pos < off <= (pos + a.fullspan); return get_expr(a, off, pos)
            end
            pos += a.fullspan
        end
        nothing
    elseif pos == 0; x
    elseif (pos < off <= (pos + x.fullspan)); x
    end
end