"""
`FNode` is a node used for formatting which does not have a `JLParser` equivalent.
"""
@enum(
    FNode,

    # leaf nodes
    NEWLINE,
    SEMICOL,
    WHITESPACE,
    PLACEHOLDER,
    NOTCODE,
    INLINECOMMENT,
    TRAILINGCOMMA,
    TRAILINGSEMICOL,
    INVERSETRAILINGSEMICOL,

    # no equivalent in JLParser
    MacroBlock,
)

@enum(NestBehavior, AllowNest, AlwaysNest, NeverNest, NeverNestNode)

"""
Formatted Syntax Tree
"""
mutable struct FST
    typ::Union{JLParser.Head,FNode}

    # Start and end lines of the node
    # in the original source file.
    startline::Int
    endline::Int

    indent::Int
    len::Int
    val::Union{Nothing,AbstractString}
    nodes::Union{Nothing,Vector{FST}}
    ref::Union{Nothing,Ref{JLParser.EXPR}}
    nest_behavior::NestBehavior

    # Extra margin caused by parent nodes.
    # i.e. `(f(arg))`
    #
    # `f(arg)` would have `extra_margin` = 1
    # due to `)` after `f(arg)`.
    extra_margin::Int
    line_offset::Int
end

FST(cst::JLParser.EXPR, indent::Int) =
    FST(cst.typ, -1, -1, indent, 0, nothing, FST[], Ref(cst), AllowNest, 0, -1)

FST(typ::JLParser.Head, indent::Int) =
    FST(typ, -1, -1, indent, 0, nothing, FST[], nothing, AllowNest, 0, -1)

function FST(
    cst::JLParser.EXPR,
    line_offset::Int,
    startline::Int,
    endline::Int,
    val::AbstractString,
)
    FST(
        cst.typ,
        startline,
        endline,
        0,
        length(val),
        val,
        nothing,
        Ref(cst),
        AllowNest,
        0,
        line_offset,
    )
end

function FST(
    typ::JLParser.Head,
    line_offset::Int,
    startline::Int,
    endline::Int,
    val::AbstractString,
)
    FST(
        typ,
        startline,
        endline,
        0,
        length(val),
        val,
        nothing,
        nothing,
        AllowNest,
        0,
        line_offset,
    )
end

@inline function Base.setindex!(fst::FST, node::FST, ind::Int)
    fst.len -= fst.nodes[ind].len
    fst.nodes[ind] = node
    fst.len += node.len
end
@inline Base.getindex(fst::FST, inds...) = fst.nodes[inds...]
@inline Base.lastindex(fst::FST) = length(fst.nodes)
@inline Base.firstindex(fst::FST) = 1
@inline Base.length(fst::FST) = fst.len
@inline function Base.iterate(fst::FST, state = 1)
    if state > length(fst.nodes)
        return nothing
    end
    return fst.nodes[state], state + 1
end

@inline function Base.insert!(fst::FST, ind::Int, node::FST)
    insert!(fst.nodes, ind, node)
    fst.len += node.len
    return
end

@inline Newline(; length = 0, nest_behavior = AllowNest) =
    FST(NEWLINE, -1, -1, 0, length, "\n", nothing, nothing, nest_behavior, 0, -1)
@inline Semicolon() = FST(SEMICOL, -1, -1, 0, 1, ";", nothing, nothing, AllowNest, 0, -1)
@inline TrailingComma() =
    FST(TRAILINGCOMMA, -1, -1, 0, 0, "", nothing, nothing, AllowNest, 0, -1)
@inline TrailingSemicolon() =
    FST(TRAILINGSEMICOL, -1, -1, 0, 0, "", nothing, nothing, AllowNest, 0, -1)
@inline InverseTrailingSemicolon() =
    FST(INVERSETRAILINGSEMICOL, -1, -1, 0, 1, ";", nothing, nothing, AllowNest, 0, -1)
@inline Whitespace(n) =
    FST(WHITESPACE, -1, -1, 0, n, " "^n, nothing, nothing, AllowNest, 0, -1)
@inline Placeholder(n) =
    FST(PLACEHOLDER, -1, -1, 0, n, " "^n, nothing, nothing, AllowNest, 0, -1)
@inline Notcode(startline, endline) =
    FST(NOTCODE, startline, endline, 0, 0, "", nothing, nothing, AllowNest, 0, -1)
@inline InlineComment(line) =
    FST(INLINECOMMENT, line, line, 0, 0, "", nothing, nothing, AllowNest, 0, -1)

@inline must_nest(fst::FST) = fst.nest_behavior === AlwaysNest
@inline cant_nest(fst::FST) = fst.nest_behavior === NeverNest
@inline can_nest(fst::FST) = fst.nest_behavior === AllowNest

@inline is_leaf(cst::JLParser.EXPR) = cst.args === nothing
@inline is_leaf(fst::FST) = fst.nodes === nothing

@inline is_punc(cst::JLParser.EXPR) = JLParser.ispunctuation(cst)
@inline is_punc(fst::FST) = fst.typ === JLParser.PUNCTUATION
@inline is_end(x) = x.typ === JLParser.KEYWORD && x.val == "end"
@inline is_colon(x) = x.typ === JLParser.OPERATOR && x.val == ":"
@inline is_comma(fst::FST) =
    (fst.typ === JLParser.PUNCTUATION && fst.val == ",") || fst.typ === TRAILINGCOMMA
@inline is_comment(fst::FST) = fst.typ === INLINECOMMENT || fst.typ === NOTCODE

@inline is_colon_op(cst::JLParser.EXPR) =
    (cst.typ === JLParser.BinaryOpCall && cst[2].kind === Tokens.COLON) ||
    cst.typ === JLParser.ColonOpCall

@inline is_colon_op(fst::FST) =
    (fst.typ === JLParser.BinaryOpCall && op_kind(fst) === Tokens.COLON) ||
    fst.typ === JLParser.ColonOpCall

@inline function is_number(cst::JLParser.EXPR)
    cst.typ === JLParser.LITERAL || return false
    return cst.kind === Tokens.INTEGER || cst.kind === Tokens.FLOAT
end

function is_multiline(fst::FST)
    fst.typ === JLParser.StringH && return true
    if fst.typ === JLParser.x_Str && fst[2].typ === JLParser.StringH
        return true
    elseif fst.typ === JLParser.x_Cmd && fst[2].typ === JLParser.StringH
        return true
    elseif fst.typ === JLParser.Vcat && fst.endline > fst.startline
        return true
    elseif fst.typ === JLParser.TypedVcat && fst.endline > fst.startline
        return true
    end
    false
end

function is_importer_exporter(fst::FST)
    fst.typ === JLParser.Import && return true
    fst.typ === JLParser.Export && return true
    fst.typ === JLParser.Using && return true
    return false
end

@inline is_macrocall(fst::FST) = fst.typ === JLParser.MacroCall || fst.typ === MacroBlock

function is_macrodoc(cst::JLParser.EXPR)
    return cst.typ === JLParser.MacroCall &&
           length(cst) == 3 &&
           cst[1].typ === JLParser.MacroName &&
           cst[1][2].val == "doc" &&
           is_str(cst[2])
end

# f a function which returns a bool
function parent_is(cst::JLParser.EXPR, valid; ignore = _ -> false)
    p = cst.parent
    p === nothing && return false
    while p !== nothing && ignore(p)
        p = p.parent
    end
    valid(p)
end

contains_comment(nodes::Vector{FST}) = findfirst(is_comment, nodes) !== nothing
function contains_comment(fst::FST)
    is_leaf(fst) && return false
    contains_comment(fst.nodes)
end

# TODO: Remove once this is fixed in JLParser.
# https://github.com/julia-vscode/JLParser.jl/issues/108
function get_args(cst::JLParser.EXPR)
    if cst.typ === JLParser.MacroCall ||
       cst.typ === JLParser.TypedVcat ||
       cst.typ === JLParser.Ref ||
       cst.typ === JLParser.Curly ||
       cst.typ === JLParser.Call
        return get_args(cst.args[2:end])
    elseif cst.typ === JLParser.WhereOpCall
        # get the arguments in B of `A where B`
        return get_args(cst.args[3:end])
    elseif cst.typ === JLParser.Braces ||
           cst.typ === JLParser.Vcat ||
           cst.typ === JLParser.BracesCat ||
           cst.typ === JLParser.TupleH ||
           cst.typ === JLParser.Vect ||
           cst.typ === JLParser.InvisBrackets ||
           cst.typ === JLParser.Parameters
        return get_args(cst.args)
    end
    JLParser.get_args(cst)
end

function get_args(args::Vector{JLParser.EXPR})
    args0 = JLParser.EXPR[]
    for a in args
        JLParser.ispunctuation(a) && continue
        if JLParser.typof(a) === JLParser.Parameters
            for j = 1:length(a.args)
                parg = a[j]
                JLParser.ispunctuation(parg) && continue
                push!(args0, parg)
            end
        else
            push!(args0, a)
        end
    end
    args0
end
@inline n_args(x) = length(get_args(x))

function add_node!(t::FST, n::FST, s::Formatter; join_lines = false, max_padding = -1)
    if n.typ === SEMICOL
        join_lines = true
        loc =
            s.off > length(s.doc.text) && t.typ === JLParser.Top ?
            cursor_loc(s, s.off - 1) : cursor_loc(s)
        for l = t.endline:loc[1]
            if has_semicol(s.doc, l)
                n.startline = l
                n.endline = l
                break
            end
        end

        # If there's no semicol, treat it
        # as a FNode
        if n.startline == -1
            t.len += length(n)
            n.startline = t.endline
            n.endline = t.endline
            push!(t.nodes, n)
            return
        end
    elseif n.typ === TRAILINGCOMMA
        en = t.nodes[end]
        if en.typ === JLParser.Generator ||
           en.typ === JLParser.Filter ||
           en.typ === JLParser.Flatten ||
           en.typ === JLParser.MacroCall ||
           en.typ === MacroBlock ||
           (is_comma(en) && t.typ === JLParser.TupleH && n_args(t.ref[]) == 1)
            # don't insert trailing comma in these cases
        elseif is_comma(en)
            t.nodes[end] = n
            t.len -= 1
        else
            t.len += length(n)
            n.startline = t.startline
            n.endline = t.endline
            push!(t.nodes, n)
        end
        return
    elseif n.typ === NOTCODE
        n.indent = s.indent
        push!(t.nodes, n)
        return
    elseif n.typ === INLINECOMMENT
        push!(t.nodes, n)
        return
    elseif n.typ isa FNode && is_leaf(n)
        t.len += length(n)
        n.startline = t.startline
        n.endline = t.endline
        push!(t.nodes, n)
        return
    end

    if n.typ === JLParser.Block && length(n) == 0
        push!(t.nodes, n)
        return
    elseif n.typ === JLParser.Parameters
        # unpack Parameters arguments into the parent node
        if n_args(t.ref[]) == n_args(n.ref[])
            # There are no arguments prior to params
            # so we can remove the initial placeholder.
            idx = findfirst(n -> n.typ === PLACEHOLDER, t.nodes)
            idx !== nothing && (t[idx] = Whitespace(0))
        end
        add_node!(t, Semicolon(), s)

        if length(n.nodes) > 0
            nws = 1
            if (t.typ === JLParser.Curly || t.typ === JLParser.WhereOpCall) &&
               !s.opts.whitespace_typedefs
                nws = 0
            end
            multi_arg = n_args(t.ref[]) > 0
            multi_arg ? add_node!(t, Placeholder(nws), s) : add_node!(t, Whitespace(nws), s)
        end
        for nn in n.nodes
            add_node!(t, nn, s, join_lines = true)
        end
        return
    elseif s.opts.import_to_using && n.typ === JLParser.Import
        usings = import_to_usings(n, s)
        if length(usings) > 0
            for nn in usings
                add_node!(t, nn, s, join_lines = false, max_padding = 0)
            end
            return
        end
    elseif n.typ === JLParser.BinaryOpCall &&
           n[1].typ === JLParser.BinaryOpCall &&
           n[1][end].typ === JLParser.WhereOpCall
        # normalize FST representation for WhereOpCall
        binaryop_to_whereop!(n, s)
    end

    if length(t.nodes) == 0
        t.startline = n.startline
        t.endline = n.endline
        t.len += length(n)
        t.line_offset = n.line_offset
        push!(t.nodes, n)
        return
    end

    if !is_prev_newline(t.nodes[end])
        current_line = t.endline
        notcode_startline = current_line + 1
        notcode_endline = n.startline - 1
        nt = t.nodes[end].typ

        if notcode_startline <= notcode_endline
            # If there are comments in between node elements
            # nesting is forced in an effort to preserve them.

            rm_block_nl =
                s.opts.remove_extra_newlines &&
                t.typ !== JLParser.ModuleH &&
                (n.typ === JLParser.Block || is_end(n))

            if remove_empty_notcode(t) || rm_block_nl
                nest = false
                for l = notcode_startline:notcode_endline
                    if hascomment(s.doc, l)
                        nest = true
                        break
                    end
                end
                if !nest
                    if rm_block_nl
                        add_node!(t, Newline(), s)
                    end
                    @goto add_node_end
                end
            end

            t.nest_behavior = AlwaysNest

            # If the previous node type is WHITESPACE - reset it.
            # This fixes cases similar to the one shown in issue #51.
            nt === WHITESPACE && (t.nodes[end] = Whitespace(0))

            hs = hascomment(s.doc, current_line)
            hs && add_node!(t, InlineComment(current_line), s)
            if nt !== PLACEHOLDER
                add_node!(t, Newline(nest_behavior = AlwaysNest), s)
            elseif hs && nt === PLACEHOLDER
                # swap PLACEHOLDER (will be NEWLINE) with INLINECOMMENT node
                idx = length(t.nodes)
                t.nodes[idx-1], t.nodes[idx] = t.nodes[idx], t.nodes[idx-1]
            end
            add_node!(t, Notcode(notcode_startline, notcode_endline), s)
            add_node!(t, Newline(nest_behavior = AlwaysNest), s)
        elseif !join_lines
            if hascomment(s.doc, current_line) && current_line != n.startline
                add_node!(t, InlineComment(current_line), s)
            end
            add_node!(t, Newline(nest_behavior = AlwaysNest), s)
        elseif nt === PLACEHOLDER &&
               current_line != n.startline &&
               hascomment(s.doc, current_line)
            t.nest_behavior = AlwaysNest
            add_node!(t, InlineComment(current_line), s)
            # swap PLACEHOLDER (will be NEWLINE) with INLINECOMMENT node
            idx = length(t.nodes)
            t.nodes[idx-1], t.nodes[idx] = t.nodes[idx], t.nodes[idx-1]
        end
    end

    @label add_node_end

    if n.startline < t.startline || t.startline == -1
        t.startline = n.startline
    end
    if n.endline > t.endline || t.endline == -1
        t.endline = n.endline
    end

    if !join_lines && is_end(n)
        # end keyword isn't useful w.r.t margin lengths
    elseif t.typ === JLParser.StringH
        # The length of this node is the length of
        # the longest string. The length of the string is
        # only considered "in the positive" when it's past
        # the hits the initial """ off, i.e. `t.indent`.
        t.len = max(t.len, n.indent + length(n) - t.indent)
    elseif is_multiline(n)
        is_iterable(t) && n_args(t.ref[]) > 1 && (t.nest_behavior = AlwaysNest)
        t.len += length(n)
    elseif max_padding >= 0
        t.len = max(t.len, length(n) + max_padding)
    else
        t.len += length(n)
    end
    push!(t.nodes, n)
    nothing
end

@inline function is_prev_newline(fst::FST)
    if fst.typ === NEWLINE
        return true
    elseif is_leaf(fst) || length(fst.nodes) == 0
        return false
    end
    is_prev_newline(fst[end])
end

"""
    `length_to(x::FST, ntyps; start::Int = 1)`

Returns the length to any node type in `ntyps` based off the `start` index.
"""
@inline function length_to(fst::FST, ntyps; start::Int = 1)
    fst.typ in ntyps && return 0, true
    is_leaf(fst) && return length(fst), false
    len = 0
    for i = start:length(fst.nodes)
        l, found = length_to(fst.nodes[i], ntyps)
        len += l
        found && return len, found
    end
    return len, false
end

@inline is_closer(fst::FST) =
    fst.typ === JLParser.PUNCTUATION &&
    (fst.val == "}" || fst.val == ")" || fst.val == "]")
@inline is_closer(cst::JLParser.EXPR) =
    cst.kind === Tokens.RBRACE || cst.kind === Tokens.RPAREN || cst.kind === Tokens.RSQUARE

@inline is_opener(fst::FST) =
    fst.typ === JLParser.PUNCTUATION &&
    (fst.val == "{" || fst.val == "(" || fst.val == "[")
@inline is_opener(cst::JLParser.EXPR) =
    cst.kind === Tokens.LBRACE || cst.kind === Tokens.LPAREN || cst.kind === Tokens.LSQUARE

@inline is_str(cst::JLParser.EXPR) = is_str_or_cmd(cst.kind) || is_str_or_cmd(cst.typ)

function is_iterable(x::Union{JLParser.EXPR,FST})
    x.typ === JLParser.TupleH && return true
    x.typ === JLParser.Vect && return true
    x.typ === JLParser.Vcat && return true
    x.typ === JLParser.Braces && return true
    x.typ === JLParser.Call && return true
    x.typ === JLParser.Curly && return true
    x.typ === JLParser.Comprehension && return true
    x.typ === JLParser.TypedComprehension && return true
    x.typ === JLParser.MacroCall && return true
    x.typ === JLParser.InvisBrackets && return true
    x.typ === JLParser.Ref && return true
    x.typ === JLParser.TypedVcat && return true
    x.typ === JLParser.Import && return true
    x.typ === JLParser.Using && return true
    x.typ === JLParser.Export && return true
    return false
end

function is_block(x::Union{JLParser.EXPR,FST})
    x.typ === JLParser.If && return true
    x.typ === JLParser.Do && return true
    x.typ === JLParser.Try && return true
    x.typ === JLParser.Begin && return true
    x.typ === JLParser.For && return true
    x.typ === JLParser.While && return true
    x.typ === JLParser.Let && return true
    (x.typ === JLParser.Quote && x[1].val == "quote") && return true
    return false
end

function is_opcall(x::Union{JLParser.EXPR,FST})
    x.typ === JLParser.BinaryOpCall && return true
    x.typ === JLParser.Comparison && return true
    x.typ === JLParser.ChainOpCall && return true
    # InvisBrackets are often mixed with operators
    # so kwargs are propagated through its related
    # functions
    x.typ === JLParser.InvisBrackets && return true
    return false
end

# Generator typ
# (x for x in 1:10)
# (x for x in 1:10 if x % 2 == 0)
function is_gen(x::Union{JLParser.EXPR,FST})
    x.typ === JLParser.Generator && return true
    x.typ === JLParser.Filter && return true
    x.typ === JLParser.Flatten && return true
    # x.typ === JLParser.InvisBrackets && return true
    return false
end

function is_assignment(x::Union{FST,JLParser.EXPR})
    if x.typ === JLParser.BinaryOpCall && is_assignment(op_kind(x))
        return true
    end

    if (
        x.typ === JLParser.Const ||
        x.typ === JLParser.Local ||
        x.typ === JLParser.Global ||
        x.typ === JLParser.Outer ||
        x.typ === MacroBlock
    ) && is_assignment(x[end])
        return true
    end

    return false
end
is_assignment(kind::Tokens.Kind) = JLParser.precedence(kind) == JLParser.AssignmentOp
is_assignment(::Nothing) = false

function is_function_or_macro_def(cst::JLParser.EXPR)
    JLParser.defines_function(cst) && return true
    cst.typ === JLParser.Macro && return true
    cst.typ === JLParser.WhereOpCall && return true
    return false
end

function nest_block(cst::JLParser.EXPR)
    cst.typ === JLParser.If && return true
    cst.typ === JLParser.Do && return true
    cst.typ === JLParser.Try && return true
    cst.typ === JLParser.For && return true
    cst.typ === JLParser.While && return true
    cst.typ === JLParser.Let && return true
    return false
end

function remove_empty_notcode(fst::FST)
    is_iterable(fst) && return true
    fst.typ === JLParser.BinaryOpCall && return true
    fst.typ === JLParser.ConditionalOpCall && return true
    fst.typ === JLParser.Comparison && return true
    fst.typ === JLParser.ChainOpCall && return true
    return false
end

nest_assignment(cst::JLParser.EXPR) = is_assignment(cst[2].kind)

function unnestable_arg(cst::JLParser.EXPR)
    is_iterable(cst) && return true
    is_str(cst) && return true
    cst.typ === JLParser.LITERAL && return true
    cst.typ === JLParser.UnaryOpCall && cst[2].kind === Tokens.DDDOT && return true
    cst.typ === JLParser.BinaryOpCall && cst[2].kind === Tokens.DOT && return true
    return false
end

function nestable(::S, cst::JLParser.EXPR) where {S<:AbstractStyle}
    JLParser.defines_function(cst) && cst[1].typ !== JLParser.UnaryOpCall && return true
    nest_assignment(cst) && return !is_str(cst[3])
    true
end

function nest_rhs(cst::JLParser.EXPR)::Bool
    if JLParser.defines_function(cst)
        rhs = cst[3]
        rhs.typ === JLParser.Block && (rhs = rhs[1])
        return nest_block(rhs)
    end
    false
end

function op_kind(cst::JLParser.EXPR)::Union{Nothing,Tokens.Kind}
    if cst.typ === JLParser.BinaryOpCall ||
       cst.typ === JLParser.Comparison ||
       cst.typ === JLParser.ChainOpCall
        return cst[2].kind
    elseif cst.typ === JLParser.UnaryOpCall
        return cst[1].typ === JLParser.OPERATOR ? cst[1].kind : cst[2].kind
    end
    return nothing
end
op_kind(::Nothing) = nothing
function op_kind(fst::FST)::Union{Nothing,Tokens.Kind}
    fst.ref === nothing ? nothing : op_kind(fst.ref[])
end

get_op(fst::FST) = findfirst(n -> n.typ === JLParser.OPERATOR, fst.nodes)
get_op(cst::JLParser.EXPR) = cst[2]

is_lazy_op(kind) = kind === Tokens.LAZY_AND || kind === Tokens.LAZY_OR

"""
    is_standalone_shortcircuit(cst::JLParser.EXPR)

Returns `true` if the `cst` is a short-circuit expression (uses `&&`, `||`)
and is *standalone*, meaning it's not directly associated with another statement or
expression.

### Examples

```julia
# this IS a standalone short-circuit
a && b

# this IS NOT a standalone short-circuit
if a && b
end

# this IS NOT a standalone short-circuit
var = a && b

# this IS NOT a standalone short-circuit
@macro a && b

# operation inside parenthesis IS NOT a standalone short-circuit
# operation outside parenthesis IS a standalone short-circuit
(a && b) && c
```
"""
function is_standalone_shortcircuit(cst::JLParser.EXPR)
    kind = op_kind(cst)
    is_lazy_op(kind) || return false

    function valid(n)
        n === nothing && return true
        n.typ === JLParser.InvisBrackets && return false
        n.typ === JLParser.MacroCall && return false
        n.typ === JLParser.Return && return false
        n.typ === JLParser.If && return false
        n.typ === JLParser.Block && nest_assignment(n.parent) && return false
        n.typ === JLParser.BinaryOpCall && nest_assignment(n) && return false
        return true
    end

    function ignore(n::JLParser.EXPR)
        n.typ === JLParser.InvisBrackets && return false
        n.typ === JLParser.If && return false
        n.typ === JLParser.Block && return false
        n.typ === JLParser.MacroCall && return false
        n.typ === JLParser.Return && return false
        n.typ === JLParser.BinaryOpCall && nest_assignment(n) && return false
        return true
    end

    return parent_is(cst, valid, ignore = ignore)
end

"""
    separate_kwargs_with_semicol!(fst::FST)

Ensures keyword arguments are separated with a ";".

### Examples

Replace "," with ";".

```julia
a = f(x, y = 3)

->

a = f(x; y = 3)
```

Move ";" to the prior to the first positional argument.

```julia
a = f(x = 1; y = 2)

->

a = f(; x = 1, y = 2)
```
"""
function separate_kwargs_with_semicol!(fst::FST)
    kw_idx = findfirst(n -> n.typ === JLParser.Kw, fst.nodes)
    kw_idx === nothing && return
    sc_idx = findfirst(n -> n.typ === SEMICOL, fst.nodes)
    # first "," prior to a kwarg
    comma_idx = findlast(is_comma, fst.nodes[1:kw_idx-1])
    ph_idx = findlast(n -> n.typ === PLACEHOLDER, fst.nodes[1:kw_idx-1])
    # @info "" kw_idx sc_idx comma_idx ph_idx

    if sc_idx !== nothing && sc_idx > kw_idx
        # move ; prior to first kwarg
        fst[sc_idx].val = ","
        fst[sc_idx].typ = JLParser.PUNCTUATION
        if comma_idx === nothing
            if ph_idx !== nothing
                fst[ph_idx] = Placeholder(1)
                insert!(fst, ph_idx, Semicolon())
            else
                insert!(fst, kw_idx, Placeholder(1))
                insert!(fst, kw_idx, Semicolon())
            end
        end
    elseif sc_idx === nothing && comma_idx === nothing
        if ph_idx !== nothing
            fst[ph_idx] = Placeholder(1)
            insert!(fst, ph_idx, Semicolon())
        else
            insert!(fst, kw_idx, Placeholder(1))
            insert!(fst, kw_idx, Semicolon())
        end
    elseif sc_idx === nothing
        fst[comma_idx].val = ";"
        fst[comma_idx].typ = SEMICOL
    end
    return
end
