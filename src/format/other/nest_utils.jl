function skip_indent(fst::FST)
    if fst.typ === JLParser.LITERAL && fst.val == ""
        return true
    elseif fst.typ === NEWLINE || fst.typ === NOTCODE
        return true
    end
    false
end

function walk(f, nodes::Vector{FST}, s::Formatter, indent::Int)
    for (i, n) in enumerate(nodes)
        if n.typ === NEWLINE && i < length(nodes)
            if is_closer(nodes[i+1])
                s.line_offset = nodes[i+1].indent
            elseif !skip_indent(nodes[i+1])
                s.line_offset = indent
            end
        else
            walk(f, n, s)
        end
    end
end

"""
    walk(f, fst::FST, s::Formatter)

Walks `fst` calling `f` on each node.

In situations where descending further into a subtree is not desirable `f`
should return a value other than `nothing`.
"""
function walk(f, fst::FST, s::Formatter)
    stop = f(fst, s)
    (stop != nothing || is_leaf(fst)) && return
    walk(f, fst.nodes, s, fst.indent)
end

function increment_line_offset!(fst::FST, s::Formatter)
    is_leaf(fst) || return
    s.line_offset += length(fst)
    return nothing
end

function add_indent!(fst::FST, s::Formatter, indent)
    indent == 0 && return
    lo = s.line_offset
    f = (fst::FST, s::Formatter) -> begin
        fst.indent += indent
        return nothing
    end
    walk(f, fst, s)
    s.line_offset = lo
end

# unnest, converts newlines to whitespace
function unnest!(fst::FST, nl_inds::Vector{Int})
    for (i, ind) in enumerate(nl_inds)
        fst[ind] = Whitespace(fst[ind].len)
        i == length(nl_inds) || continue
        pn = fst[ind-1]
        if pn.typ === TRAILINGCOMMA || pn.typ === TRAILINGSEMICOL
            pn.val = ""
            pn.len = 0
        elseif pn.typ === INVERSETRAILINGSEMICOL
            pn.val = ";"
            pn.len = 1
        elseif fst.typ === JLParser.BinaryOpCall && fst[ind+1].typ === WHITESPACE
            # remove additional indent
            fst[ind+1] = Whitespace(0)
        end
    end
end

function dedent!(fst::FST, s::Formatter)
    if is_leaf(fst)
        s.line_offset += length(fst)
        if is_closer(fst) || fst.typ === NOTCODE
            fst.indent -= s.opts.indent
        end
        return
    elseif fst.typ === JLParser.StringH
        return
    end

    # dedent
    fst.indent -= s.opts.indent

    # only unnest if it's allowed
    can_nest(fst) || return

    nl_inds = findall(n -> n.typ === NEWLINE && can_nest(n), fst.nodes)
    length(nl_inds) > 0 || return
    margin = s.line_offset + fst.extra_margin + length(fst)
    margin <= s.opts.margin || return
    unnest!(fst, nl_inds)
end

"""
    nest_if_over_margin!(
        style,
        fst::FST,
        s::Formatter,
        idx::Int;
        stop_idx::Union{Int,Nothing} = nothing,
    )

Converts the node at `idx` to a `NEWLINE` if the margin until `stop_idx` is greater than
the allowed margin.

If `stop_idx` is `nothing`, the margin of all nodes in `fst` including and after `idx` will
be included.
"""
function nest_if_over_margin!(
    style,
    fst::FST,
    s::Formatter,
    idx::Int;
    stop_idx::Union{Int,Nothing} = nothing,
)
    @assert fst[idx].typ == PLACEHOLDER
    margin = s.line_offset
    if stop_idx === nothing
        margin += sum(length.(fst[idx:end])) + fst.extra_margin
    else
        margin += sum(length.(fst[idx:stop_idx-1]))
    end

    if margin > s.opts.margin || is_comment(fst[idx+1]) || is_comment(fst[idx-1])
        fst[idx] = Newline(length = fst[idx].len)
        s.line_offset = fst.indent
    else
        nest!(style, fst[idx], s)
    end
end
