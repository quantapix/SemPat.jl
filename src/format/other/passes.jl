# FST passes/transforms

function flattenable(kind::Tokens.Kind)
    kind === Tokens.AND && return true
    kind === Tokens.OR && return true
    kind === Tokens.LAZY_AND && return true
    kind === Tokens.LAZY_OR && return true
    kind === Tokens.RPIPE && return true
    return false
end
flattenable(::Nothing) = false

"""
Flattens a binary operation call tree if the operation repeats 2 or more times.
"a && b && c" will be transformed while "a && b" will not.
"""
function flatten_binaryopcall(fst::FST; top = true)
    nodes = FST[]
    kind = op_kind(fst)

    lhs = fst[1]
    rhs = fst[end]
    lhs_kind = op_kind(lhs)
    rhs_kind = op_kind(rhs)
    lhs_same_op = lhs_kind === kind
    rhs_same_op = rhs_kind === kind
    idx = findlast(n -> n.typ === PLACEHOLDER, fst.nodes)

    if (top && !lhs_same_op && !rhs_same_op) || idx === nothing
        return nodes
    end

    if lhs_same_op
        push!(nodes, flatten_binaryopcall(lhs, top = false)...)
    else
        flatten_fst!(lhs)
        push!(nodes, lhs)
    end
    # everything except the indentation placeholder
    push!(nodes, fst[2:idx-1]...)

    if rhs_same_op
        push!(nodes, flatten_binaryopcall(rhs, top = false)...)
    else
        flatten_fst!(rhs)
        push!(nodes, rhs)
    end

    return nodes
end

function flatten_conditionalopcall(fst::FST)
    nodes = FST[]
    for n in fst.nodes
        if n.typ === JLParser.ConditionalOpCall
            push!(nodes, flatten_conditionalopcall(n)...)
        else
            push!(nodes, n)
        end
    end
    return nodes
end

function flatten_fst!(fst::FST)
    is_leaf(fst) && return
    for n in fst.nodes
        if is_leaf(n)
            continue
        elseif n.typ === JLParser.BinaryOpCall && flattenable(op_kind(n))
            # possibly convert BinaryOpCall to ChainOpCall
            nnodes = flatten_binaryopcall(n)
            if length(nnodes) > 0
                n.typ = JLParser.ChainOpCall
                n.nodes = nnodes
            else
                flatten_fst!(n)
            end
        else
            flatten_fst!(n)
        end
    end
end

"""
    pipe_to_function_format_calls!(fst::FST)

Rewrites `x |> f` to `f(x)`.
"""
function pipe_to_function_format_calls!(fst::FST)
    is_leaf(fst) && return

    if op_kind(fst) === Tokens.RPIPE
        fst.nodes = pipe_to_function_call(fst)
        fst.typ = JLParser.Call
        return
    end

    for n in fst.nodes
        if is_leaf(n)
            continue
        elseif op_kind(n) === Tokens.RPIPE
            n.nodes = pipe_to_function_call(n)
            n.typ = JLParser.Call
        else
            pipe_to_function_format_calls!(n)
        end
    end
end

function pipe_to_function_call(fst::FST)
    nodes = FST[]
    arg2 = fst[end]
    push!(nodes, arg2)
    paren = FST(JLParser.PUNCTUATION, -1, arg2.endline, arg2.endline, "(")
    push!(nodes, paren)
    pipe_to_function_format_calls!(fst[1])
    arg1 = fst[1]
    push!(nodes, arg1)
    paren = FST(JLParser.PUNCTUATION, -1, arg1.endline, arg1.endline, ")")
    push!(nodes, paren)
    return nodes
end

function import_to_usings(fst::FST, s::Formatter)
    findfirst(is_colon, fst.nodes) === nothing || return FST[]
    findfirst(n -> is_punc(n) && n.val == ".", fst.nodes) === nothing || return FST[]

    usings = FST[]
    idxs = findall(n -> n.typ === JLParser.IDENTIFIER, fst.nodes)

    for i in idxs
        name = fst[i].val
        sl = fst[i].startline
        el = fst[i].endline
        use = FST(JLParser.Using, fst.indent)
        use.startline = sl
        use.endline = el

        add_node!(use, FST(JLParser.KEYWORD, -1, sl, el, "using"), s)
        add_node!(use, Whitespace(1), s)

        # collect the dots prior to a identifier
        # import ..A
        j = i - 1
        while fst[j].typ === JLParser.OPERATOR
            add_node!(use, fst[j], s, join_lines = true)
            j -= 1
        end

        add_node!(use, FST(JLParser.IDENTIFIER, -1, sl, el, name), s, join_lines = true)
        add_node!(use, FST(JLParser.OPERATOR, -1, sl, el, ":"), s, join_lines = true)
        add_node!(use, Whitespace(1), s)
        add_node!(use, FST(JLParser.IDENTIFIER, -1, sl, el, name), s, join_lines = true)

        push!(usings, use)
    end
    return usings
end

"""
    annotate_typefields_with_any!(fst::FST, s::Formatter)

Annotates fields in a type definitions with `::Any` if
no type annotation is provided.
"""
function annotate_typefields_with_any!(fst::FST, s::Formatter)
    is_leaf(fst) && return
    for (i, n) in enumerate(fst.nodes)
        if n.typ === JLParser.IDENTIFIER
            nn = FST(JLParser.BinaryOpCall, n.indent)
            nn.startline = n.startline
            nn.endline = n.endline
            add_node!(nn, n, s)
            line_offset = n.line_offset + length(n)
            add_node!(
                nn,
                FST(JLParser.OPERATOR, line_offset, n.startline, n.endline, "::"),
                s,
                join_lines = true,
            )
            line_offset += 2
            add_node!(
                nn,
                FST(JLParser.IDENTIFIER, line_offset, n.startline, n.endline, "Any"),
                s,
                join_lines = true,
            )
            fst[i] = nn
        else
            continue
        end
    end
end

"""
    short_to_long_function_def!(fst::FST, s::Formatter)

Transforms a *short* function definition

```julia
f(arg1, arg2) = body
```

to a *long* function definition

```julia
function f(arg2, arg2)
    body
end
```
"""
function short_to_long_function_def!(fst::FST, s::Formatter)
    # 3 cases
    #
    # case 1
    #   func(a) = body
    #
    # case 2
    #   func(a::T) where T = body
    #
    # case 3
    #   func(a::T)::R where T = body

    funcdef = FST(JLParser.FunctionDef, fst.indent)
    if fst[1].typ === JLParser.Call || fst[1].typ === JLParser.WhereOpCall
        # function
        kw = FST(JLParser.KEYWORD, -1, fst[1].startline, fst[1].endline, "function")
        add_node!(funcdef, kw, s)
        add_node!(funcdef, Whitespace(1), s)

        # func(a)
        # OR
        # func(a) where T
        add_node!(funcdef, fst[1], s, join_lines = true)

        # body
        s.opts.always_use_return && prepend_return!(fst[end], s)
        add_node!(funcdef, fst[end], s, max_padding = s.opts.indent)
        add_indent!(funcdef[end], s, s.opts.indent)

        # end
        kw = FST(JLParser.KEYWORD, -1, fst[end].startline, fst[end].endline, "end")
        add_node!(funcdef, kw, s)

        fst.typ = funcdef.typ
        fst.nodes = funcdef.nodes
        fst.len = funcdef.len
    elseif fst[1].typ === JLParser.BinaryOpCall &&
           fst[1][end].typ === JLParser.WhereOpCall
        # function
        kw = FST(JLParser.KEYWORD, -1, fst[1].startline, fst[1].endline, "function")
        add_node!(funcdef, kw, s)
        add_node!(funcdef, Whitespace(1), s)

        # func(a)
        add_node!(funcdef, fst[1][1], s, join_lines = true)

        whereop = fst[1][end]
        decl = FST(JLParser.OPERATOR, -1, fst[1].startline, fst[1].endline, "::")

        # ::R where T
        add_node!(funcdef, decl, s, join_lines = true)
        add_node!(funcdef, whereop, s, join_lines = true)

        # body
        s.opts.always_use_return && prepend_return!(fst[end], s)
        add_node!(funcdef, fst[end], s, max_padding = s.opts.indent)
        add_indent!(funcdef[end], s, s.opts.indent)

        # end
        kw = FST(JLParser.KEYWORD, -1, fst[end].startline, fst[end].endline, "end")
        add_node!(funcdef, kw, s)

        fst.typ = funcdef.typ
        fst.nodes = funcdef.nodes
        fst.len = funcdef.len
    end
end

"""
    binaryop_to_whereop(fst::FST, s::Formatter)

Handles the case of a function def defined
as:

```julia
foo(a::A)::R where A = body
```

In this case instead of it being parsed as (1):

```
JLParser.BinaryOpCall
 - JLParser.WhereOpCall
 - OP
 - RHS
```

It's parsed as (2):

```
JLParser.BinaryOpCall
 - JLParser.BinaryOpCall
  - LHS
  - OP
  - JLParser.WhereOpCall
   - R
   - ...
 - OP
 - RHS
```

(1) is preferrable since it's the same parsed result as:

```julia
foo(a::A) where A = body
```

This transformation converts (2) to (1).

ref https://github.com/julia-vscode/JLParser.jl/issues/93
"""
function binaryop_to_whereop!(fst::FST, s::Formatter)
    # transform fst[1] to a WhereOpCall
    oldbinop = fst[1]
    oldwhereop = fst[1][end]
    binop = FST(JLParser.BinaryOpCall, fst[1].indent)

    # foo(a::A)
    add_node!(binop, oldbinop[1], s)
    # foo(a::A)::
    add_node!(binop, oldbinop[2], s, join_lines = true)
    # foo(a::A)::R
    add_node!(binop, oldwhereop[1], s, join_lines = true)

    whereop = FST(JLParser.WhereOpCall, fst[1].indent)
    add_node!(whereop, binop, s)

    # "foo(a::A)::R where A"
    for n in oldwhereop[2:end]
        add_node!(whereop, n, s, join_lines = true)
    end

    fst[1] = whereop
end

"""
    prepend_return!(fst::FST, s::Formatter)

Prepends `return` to the last expression of a block.

```julia
function foo()
    a = 2 * 3
    a / 3
end
```

to

```julia
function foo()
    a = 2 * 3
    return a / 3
end
```
"""
function prepend_return!(fst::FST, s::Formatter)
    fst.typ === JLParser.Block || return
    ln = fst[end]
    is_block(ln) && return
    ln.typ === JLParser.Return && return
    ln.typ === JLParser.MacroCall && return
    ln.typ === MacroBlock && return

    ret = FST(JLParser.Return, fst.indent)
    kw = FST(JLParser.KEYWORD, -1, fst[end].startline, fst[end].endline, "return")
    add_node!(ret, kw, s)
    add_node!(ret, Whitespace(1), s)
    add_node!(ret, ln, s, join_lines = true)
    fst[end] = ret
end

"""
    move_at_sign_to_the_end(fst::FST, s::Formatter)

NOTE: Assumes `fst` is the caller name of a macrocall such as
`@macro` or `Module.@macro`.

Moves `@` to the last indentifier.

Example:

```julia
@Module.macro
```

to

```julia
Module.@macro
```
"""
function move_at_sign_to_the_end(fst::FST, s::Formatter)
    t = FST[]
    f =
        (t) ->
            (n, s) -> begin
                if is_macrocall(n) || (n.typ === JLParser.Quotenode && !is_leaf(n[1]))
                    # 1. Do not move "@" in nested macro calls
                    # 2. Do not move "@" if in the middle of a chain, i.e. "a.@b.c"
                    # since it's semantically different to "@a.b.c" and "a.b.@c"
                    push!(t, n)
                    return false
                elseif is_leaf(n)
                    push!(t, n)
                end
            end
    walk(f(t), fst, s)

    macroname = FST(JLParser.MacroName, fst.indent)
    for (i, n) in enumerate(t)
        if n.val == "@"
            continue
        elseif i < length(t)
            add_node!(macroname, n, s, join_lines = true)
        elseif n.typ === JLParser.Quotenode
            add_node!(macroname, n, s, join_lines = true)
        else
            at = FST(JLParser.PUNCTUATION, -1, n.startline, n.endline, "@")
            add_node!(macroname, at, s, join_lines = true)
            add_node!(macroname, n, s, join_lines = true)
        end
    end

    return macroname
end

"""
"""
function conditional_to_if_block!(fst::FST, s::Formatter; top = true)
    t = FST(JLParser.If, fst.indent)
    kw = FST(JLParser.KEYWORD, -1, fst.startline, fst.startline, top ? "if" : "elseif")
    add_node!(t, kw, s, max_padding = 0)
    add_node!(t, Whitespace(1), s, join_lines = true)
    add_node!(t, fst[1], s, join_lines = true)

    idx1 = findfirst(n -> n.typ === JLParser.OPERATOR && n.val == "?", fst.nodes)
    idx2 = findfirst(n -> n.typ === JLParser.OPERATOR && n.val == ":", fst.nodes)

    block1 = FST(JLParser.Block, fst.indent + s.opts.indent)
    for n in fst.nodes[idx1+1:idx2-1]
        if n.typ === PLACEHOLDER ||
           n.typ === WHITESPACE ||
           n.typ === NEWLINE ||
           is_comment(n)
            continue
        end
        add_node!(block1, n, s)
    end
    add_node!(t, block1, s, max_padding = s.opts.indent)

    block2 = FST(JLParser.Block, fst.indent)
    padding = 0
    if fst[end].typ === JLParser.ConditionalOpCall
        conditional_to_if_block!(fst[end], s, top = false)
    else
        block2.indent += s.opts.indent
        padding = s.opts.indent
        kw = FST(JLParser.KEYWORD, -1, -1, -1, "else")
        add_node!(t, kw, s, max_padding = 0)
    end
    add_node!(block2, fst[end], s)
    add_node!(t, block2, s, max_padding = 0)

    if top
        kw = FST(JLParser.KEYWORD, -1, -1, -1, "end")
        add_node!(t, kw, s, max_padding = 0)
    end

    fst.typ = t.typ
    fst.nodes = t.nodes
    fst.len = t.len

    # @info "" fst[1] fst.len

    return nothing
end
