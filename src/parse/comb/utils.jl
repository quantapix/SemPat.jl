function flatten(xs::Array{T,1}) where {T}
    ys::T = vcat(xs...)
    return ys
end

is_nl(x) = x == '\n'

function round_up(s, i)
    i = max(i, 1)
    is_nl(s[i]) ? i + 1 : i
end

function round_down(s, i)
    i = i == 0 ? lastindex(s) : i
    is_nl(s[i]) ? i - 1 : i
end

function diagnostic(s::AbstractString, i, msg)
    if i < 1; l, c, t = 0, 0, "[Before start]"
    elseif i > length(s); l, c, t = count(is_nl, s) + 2, 0, "[After end]"
    else
        l = count(is_nl, SubString(s, 1, max(1, i - 1))) + 1
        prev_index = findprev(is_nl, s, max(1, i - 1))
        p = round_up(s, something(prev_index, 0))
        next_index = findnext(is_nl, s, i)
        q = round_down(s, something(next_index, 0))
        t = SubString(s, p, q)
        c = i - p + 1
    end
    fmt_error(l, c, t, msg)
end

function fmt_error(line, col, text, msg)
    arrow = string(repeat(" ", max(col - 1, 0)), "^")
    "$(msg) at ($(line),$(col))\n$(text)\n$(arrow)\n"
end

forwards(s::AbstractString, i) = SubString(s, i)

discard(::AbstractString, i, n) = i + n

