
function align_fst!(fst::FST, opts::Opts)
    is_leaf(fst) && return
    const_idxs = Int[]
    assignment_idxs = Int[]
    pair_arrow_idxs = Int[]

    for (i, n) in enumerate(fst.nodes)
        if is_leaf(n)
            continue
        elseif opts.align_struct_field &&
               (n.typ === JLParser.Struct || n.typ === JLParser.Mutable)
            align_struct!(n)
        elseif opts.align_conditional && n.typ === JLParser.ConditionalOpCall
            align_conditional!(n)
        else
            align_fst!(n, opts)
        end

        if is_assignment(n) || n.typ === JLParser.Kw
            # Gather all assignments within the current code block
            # they will be aligned at the end
            push!(assignment_idxs, i)
        elseif n.typ === JLParser.BinaryOpCall && op_kind(n) === Tokens.PAIR_ARROW
            push!(pair_arrow_idxs, i)
        end
    end

    if opts.align_assignment
        align_binaryopcalls!(fst, assignment_idxs)
    end

    if opts.align_pair_arrow
        align_binaryopcalls!(fst, pair_arrow_idxs)
    end
end

"""
Group of FST node indices and required metadata to potentially align them.

- `node_idxs`. Indices of FST nodes affected by alignment.
- `line_offsets`. Line off of the character nodes may be aligned to
in the source file.
- `lens`. Length of the FST node prior to the alignment character. Used
to calculate extra whitespace padding.
- `whitespaces`. Number of whitespaces between the alignment character and
the prior FST node. If this is > 1 it signifies additional whitespace was
manually added by the user since the formatter would only use 0 or 1 whitespaces.

"""
struct AlignGroup
    node_idxs::Vector{Int}
    line_offsets::Vector{Int}
    lens::Vector{Int}
    whitespaces::Vector{Int}
end
AlignGroup() = AlignGroup(Int[], Int[], Int[], Int[])

function Base.push!(g::AlignGroup, idx::Int, line_offset::Int, len::Int, ws::Int)
    push!(g.node_idxs, idx)
    push!(g.line_offsets, line_offset)
    push!(g.lens, len)
    push!(g.whitespaces, ws)
    return
end

function align_to(g::AlignGroup)::Union{Nothing,Int}
    # determine whether alignment might be warranted
    max_len, max_idx = findmax(g.lens)
    max_idxs = findall(==(g.line_offsets[max_idx]), g.line_offsets)
    length(max_idxs) > 1 || return nothing

    # Is there custom whitespace?
    # Formatter would only add 0 or 1 whitespaces.
    # > 2 implies a manual edit in the source file.
    for i in max_idxs
        g.whitespaces[i] > 1 && return max_len
    end

    return nothing
end

function align_binaryopcall!(fst::FST, diff::Int)
    # insert whitespace before and after operator
    fidx = findfirst(x -> x.typ === WHITESPACE, fst.nodes)
    lidx = findlast(x -> x.typ === WHITESPACE, fst.nodes)

    if fidx === nothing
        insert!(fst, 2, Whitespace(diff))
    else
        fst[fidx] = Whitespace(diff)
    end

    if lidx === nothing
        insert!(fst, 4, Whitespace(1))
    end
end

"""
    align_struct!(fst::FST)

Aligns struct fields.
"""
function align_struct!(fst::FST)
    idx = findfirst(n -> n.typ === JLParser.Block, fst.nodes)
    idx === nothing && return
    length(fst[idx]) == 0 && return

    block_fst = fst[idx]
    prev_endline = block_fst[1].endline
    groups = AlignGroup[]
    g = AlignGroup()

    for (i, n) in enumerate(block_fst.nodes)
        if n.typ === JLParser.BinaryOpCall
            if n.startline - prev_endline > 1
                push!(groups, g)
                g = AlignGroup()
            end

            nlen = length(n[1])
            idx = findfirst(x -> x.typ === JLParser.OPERATOR, n.nodes)
            ws = n[idx].line_offset - (n.line_offset + nlen)

            push!(g, i, n[idx].line_offset, nlen, ws)
            prev_endline = n.endline
        end
    end
    push!(groups, g)

    for g in groups
        align_len = align_to(g)
        align_len === nothing && continue
        for (i, idx) in enumerate(g.node_idxs)
            diff = align_len - g.lens[i] + 1
            align_binaryopcall!(block_fst[idx], diff)
            block_fst[idx].nest_behavior = NeverNest
        end
    end
end

"""
    align_binaryopcalls!(fst::FST, op_idxs::Vector{Int})

Aligns binary operator expressions.

Additionally handles the case where a keyword such as `const` is used
prior to the binary op call.
"""
function align_binaryopcalls!(fst::FST, op_idxs::Vector{Int})
    length(op_idxs) > 1 || return
    prev_endline = fst[op_idxs[1]].endline
    groups = AlignGroup[]
    g = AlignGroup()

    for i in op_idxs
        n = fst[i]
        if n.startline - prev_endline > 1
            push!(groups, g)
            g = AlignGroup()
        end

        binop, nlen, ws = if n.typ === JLParser.BinaryOpCall || n.typ === JLParser.Kw
            nlen = length(n[1])
            n, nlen, (n[3].line_offset - n.line_offset) - nlen
        else
            binop = n[3]
            nlen = length(binop[1]) + length(fst[i][1]) + length(fst[i][2])
            binop, nlen, (binop[3].line_offset - n.line_offset) - nlen
        end

        # @info "" binop.typ nlen ws
        push!(g, i, binop[3].line_offset, nlen, ws)

        prev_endline = n.endline
    end
    push!(groups, g)

    for g in groups
        align_len = align_to(g)
        align_len === nothing && continue

        for (i, idx) in enumerate(g.node_idxs)
            diff = align_len - g.lens[i] + 1

            typ = fst[idx].typ
            if typ === JLParser.BinaryOpCall || typ === JLParser.Kw
                align_binaryopcall!(fst[idx], diff)
            else
                align_binaryopcall!(fst[idx][3], diff)
            end
            fst[idx].nest_behavior = NeverNest
        end
    end

    return
end

"""
    align_conditional!(fst::FST)

Aligns a conditional expression.
"""
function align_conditional!(fst::FST)
    nodes = flatten_conditionalopcall(fst)

    cond_group = AlignGroup()
    cond_prev_endline = 0

    colon_group = AlignGroup()
    colon_prev_endline = 0

    for (i, n) in enumerate(nodes)
        if n.typ === JLParser.OPERATOR && n.val == "?"
            if cond_prev_endline != n.endline
                nlen = length(nodes[i-2])
                ws = n.line_offset - (nodes[i-2].line_offset + nlen)
                push!(cond_group, i, n.line_offset, nlen, ws)
            end
            cond_prev_endline = n.endline
        elseif n.typ === JLParser.OPERATOR && n.val == ":"
            if colon_prev_endline != n.endline
                nlen = length(nodes[i-2])
                ws = n.line_offset - (nodes[i-2].line_offset + nlen)
                push!(colon_group, i, n.line_offset, nlen, ws)
            end
            colon_prev_endline = n.endline
        end
    end
    length(cond_group.lens) > 1 || return

    cond_len = align_to(cond_group)
    colon_len = align_to(colon_group)

    cond_len === nothing && colon_len === nothing && return

    if cond_len !== nothing
        for (i, idx) in enumerate(cond_group.node_idxs)
            diff = cond_len - cond_group.lens[i] + 1
            nodes[idx-1] = Whitespace(diff)
        end
    end

    for (i, idx) in enumerate(colon_group.node_idxs)
        # the placeholder would be i+1 if not for a possible inline comment
        nidx = findnext(n -> n.typ === PLACEHOLDER, nodes, idx + 1)
        if nodes[nidx+1].startline != nodes[nidx].startline
            nodes[nidx] = Newline(nest_behavior = AlwaysNest)
        end

        if colon_len !== nothing
            diff = colon_len - colon_group.lens[i] + 1
            nodes[idx-1] = Whitespace(diff)
        end
    end

    fst.nodes = nodes
    fst.nest_behavior = NeverNest
    fst.indent = fst.line_offset - 1

    return
end
