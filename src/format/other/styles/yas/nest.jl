function n_call!(ys::YASStyle, fst::FST, s::Formatter)
    style = getstyle(ys)
    fst.indent = s.line_offset + sum(length.(fst[1:2]))

    for (i, n) in enumerate(fst.nodes)
        if n.typ === NEWLINE
            s.line_offset = fst.indent
        elseif n.typ === PLACEHOLDER
            si = findnext(n -> n.typ === PLACEHOLDER, fst.nodes, i + 1)
            nest_if_over_margin!(style, fst, s, i; stop_idx = si)
        elseif n.typ === TRAILINGSEMICOL
            n.val = ""
            n.len = 0
            nest!(style, n, s)
        elseif is_gen(n)
            n.indent = fst.indent
            n.extra_margin = 1
            nest!(style, n, s)
        else
            diff = fst.indent - fst[i].indent
            add_indent!(n, s, diff)
            n.extra_margin = 1
            nest!(style, n, s)
        end
    end
end
@inline n_curly!(ys::YASStyle, fst::FST, s::Formatter) = n_call!(ys, fst, s)
@inline n_ref!(ys::YASStyle, fst::FST, s::Formatter) = n_call!(ys, fst, s)
@inline n_macrocall!(ys::YASStyle, fst::FST, s::Formatter) = n_call!(ys, fst, s)
@inline n_typedcomprehension!(ys::YASStyle, fst::FST, s::Formatter) = n_call!(ys, fst, s)

function n_tupleh!(ys::YASStyle, fst::FST, s::Formatter)
    style = getstyle(ys)
    fst.indent = s.line_offset
    length(fst.nodes) > 0 && is_opener(fst[1]) && (fst.indent += 1)

    for (i, n) in enumerate(fst.nodes)
        if n.typ === NEWLINE
            s.line_offset = fst.indent
        elseif n.typ === PLACEHOLDER
            si = findnext(n -> n.typ === PLACEHOLDER, fst.nodes, i + 1)
            nest_if_over_margin!(style, fst, s, i; stop_idx = si)
        elseif n.typ === TRAILINGSEMICOL
            n.val = ""
            n.len = 0
            nest!(style, n, s)
        elseif is_gen(n)
            n.indent = fst.indent
            n.extra_margin = 1
            nest!(style, n, s)
        else
            diff = fst.indent - fst[i].indent
            add_indent!(n, s, diff)
            n.extra_margin = 1
            nest!(style, n, s)
        end
    end
end
@inline n_braces!(ys::YASStyle, fst::FST, s::Formatter) = n_tupleh!(ys, fst, s)
@inline n_vect!(ys::YASStyle, fst::FST, s::Formatter) = n_tupleh!(ys, fst, s)
@inline n_parameters!(ys::YASStyle, fst::FST, s::Formatter) = n_tupleh!(ys, fst, s)
@inline n_invisbrackets!(ys::YASStyle, fst::FST, s::Formatter) = n_tupleh!(ys, fst, s)
@inline n_comprehension!(ys::YASStyle, fst::FST, s::Formatter) = n_tupleh!(ys, fst, s)

function n_generator!(ys::YASStyle, fst::FST, s::Formatter)
    style = getstyle(ys)
    diff = s.line_offset - fst[1].indent

    # if the first argument is not a leaf
    # aligns it to be inside the generator
    # expression
    add_indent!(fst[1], s, diff)

    for (i, n) in enumerate(fst.nodes)
        if n.typ === NEWLINE
            s.line_offset = fst.indent
        elseif n.typ === PLACEHOLDER
            si = findnext(n -> n.typ === PLACEHOLDER, fst.nodes, i + 1)
            nest_if_over_margin!(style, fst, s, i; stop_idx = si)
        elseif is_gen(n)
            n.indent = fst.indent
            n.extra_margin = 1
            nest!(style, n, s)
        else
            n.extra_margin = 1
            nest!(style, n, s)
        end
    end
end
@inline n_filter!(ys::YASStyle, fst::FST, s::Formatter) = n_generator!(ys, fst, s)
@inline n_flatten!(ys::YASStyle, fst::FST, s::Formatter) = n_generator!(ys, fst, s)

function n_whereopcall!(ys::YASStyle, fst::FST, s::Formatter)
    style = getstyle(ys)
    fst.indent = s.line_offset
    # after "A where "
    Blen = sum(length.(fst[2:end]))
    fst[1].extra_margin = Blen + fst.extra_margin

    for (i, n) in enumerate(fst.nodes)
        if n.typ === NEWLINE
            s.line_offset = fst.indent
        elseif n.typ === PLACEHOLDER
            si = findnext(n -> n.typ === PLACEHOLDER, fst.nodes, i + 1)
            nest_if_over_margin!(style, fst, s, i; stop_idx = si)
        elseif is_opener(n) && n.val == "{"
            fst.indent = s.line_offset + 1
            nest!(style, n, s)
        elseif i == 1
            nest!(style, n, s)
        else
            n.extra_margin = 1
            nest!(style, n, s)
        end
    end
end

function n_using!(ys::YASStyle, fst::FST, s::Formatter)
    style = getstyle(ys)
    idx = findfirst(n -> n.val == ":", fst.nodes)
    fst.indent = s.line_offset
    if idx === nothing
        fst.indent += sum(length.(fst[1:2]))
    else
        fst.indent += sum(length.(fst[1:idx+1]))
    end
    for (i, n) in enumerate(fst.nodes)
        if n.typ === PLACEHOLDER
            si = findnext(n -> n.typ === PLACEHOLDER, fst.nodes, i + 1)
            nest_if_over_margin!(style, fst, s, i; stop_idx = si)
        elseif n.typ === NEWLINE
            s.line_offset = fst.indent
        else
            nest!(style, n, s)
        end
    end
end
@inline n_export!(ys::YASStyle, fst::FST, s::Formatter) = n_using!(ys, fst, s)
@inline n_import!(ys::YASStyle, fst::FST, s::Formatter) = n_using!(ys, fst, s)

n_chainopcall!(ys::YASStyle, fst::FST, s::Formatter) =
    n_block!(DefaultStyle(ys), fst, s, indent = s.line_offset)
n_comparison!(ys::YASStyle, fst::FST, s::Formatter) =
    n_block!(DefaultStyle(ys), fst, s, indent = s.line_offset)

function n_binaryopcall!(ys::YASStyle, fst::FST, s::Formatter)
    style = getstyle(ys)
    if findfirst(n -> n.typ === PLACEHOLDER, fst.nodes) !== nothing
        n_binaryopcall!(DefaultStyle(style), fst, s)
        return
    end

    start_line_offset = s.line_offset
    walk(increment_line_offset!, fst.nodes[1:end-1], s, fst.indent)
    nest!(style, fst[end], s)
end
