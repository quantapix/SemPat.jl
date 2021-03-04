function parse_kw(p::Parser)
    k = p.tok.kind
    if k === Scan.IF; @blank p @nest p :block parse_if(p)
    elseif k === Scan.LET; @blank p @nest p :block parse_block_expr(p, Let)
    elseif k === Scan.TRY; @blank p @nest p :block parse_try(p)
    elseif k === Scan.FUNCTION; @blank p @nest p :block parse_block_expr(p, FuncDef)
    elseif k === Scan.MACRO; @blank p @nest p :block parse_block_expr(p, Macro)
    elseif k === Scan.BEGIN
        if p.nest.inref; make_kw(p)
        else @blank p @nest p :block parse_block_expr(p, Begin)
        end
    elseif k === Scan.QUOTE; @blank p @nest p :block parse_block_expr(p, Quote)
    elseif k === Scan.FOR; @blank p @nest p :block parse_block_expr(p, For)
    elseif k === Scan.WHILE; @blank p @nest p :block parse_block_expr(p, While)
    elseif k === Scan.BREAK; make_one(p)
    elseif k === Scan.CONTINUE; make_one(p)
    elseif k === Scan.IMPORT; parse_import(p)
    elseif k === Scan.USING; parse_import(p)
    elseif k === Scan.EXPORT; parse_export(p)
    elseif k === Scan.MODULE;  @blank p @nest p :block parse_block_expr(p, ModuleH)
    elseif k === Scan.BAREMODULE; @blank p @nest p :block parse_block_expr(p, BareModule)
    elseif k === Scan.CONST; @blank p parse_const(p)
    elseif k === Scan.GLOBAL; @blank p parse_global(p)
    elseif k === Scan.LOCAL; @blank p parse_local(p)
    elseif k === Scan.RETURN; @blank p parse_return(p)
    elseif k === Scan.END
        if p.nest.square; make_kw(p)
        else make_err(p, make_id(p), OddToken)
        end
    elseif k === Scan.ELSE || k === Scan.ELSEIF || k === Scan.CATCH || k === Scan.FINALLY; make_err(p, make_id(p), OddToken)
    elseif k === Scan.ABSTRACT; @blank p parse_abstract(p)
    elseif k === Scan.PRIMITIVE; @blank p parse_primitive(p)
    elseif k === Scan.TYPE; make_id(p)
    elseif k === Scan.STRUCT; @blank p @nest p :block parse_block_expr(p, Struct)
    elseif k === Scan.MUTABLE; @blank p @nest p :block parse_mutable(p)
    elseif k === Scan.OUTER; make_id(p)
    else make_err(p, Unknown)
    end
end

function parse_const(p::Parser)
    kw = make_kw(p)
    x = parse_expr(p)
    if !(is_assign(unwrap_bracket(x)) || (head(x) === Global && is_assign(unwrap_bracket(x.args[2])))); x = make_err(p, x, ExpectedAssign) end
    Exp2(Const, Exp2[kw, x])
end

function parse_global(p::Parser)
    kw = make_kw(p)
    x = parse_expr(p)
    Exp2(Global, Exp2[kw, x])
end

function parse_local(p::Parser)
    kw = make_kw(p)
    x = parse_expr(p)
    Exp2(Local, Exp2[kw, x])
end

function parse_return(p::Parser)
    kw = make_kw(p)
    x = is_nested(p) ? nothing_lit() : parse_expr(p)
    Exp2(Return, Exp2[kw, x])
end

function parse_abstract(p::Parser)
    if p.next.kind === Scan.TYPE
        kw1 = make_kw(p)
        kw2 = make_kw(next(p))
        s = @nest p :block parse_expr(p)
        Exp2(Abstract, Exp2[kw1, kw2, s, use_end(p)])
    else make_id(p)
    end
end

function parse_primitive(p::Parser)
    if p.next.kind === Scan.TYPE
        kw1 = make_kw(p)
        kw2 = make_kw(next(p))
        s = @nest p :ws @nest p :wsop parse_expr(p)
        x = @nest p :block parse_expr(p)
        Exp2(Primitive, Exp2[kw1, kw2, s, x, use_end(p)])
    else make_id(p)
    end
end

function parse_mutable(p::Parser)
    if p.next.kind === Scan.STRUCT
        kw = make_kw(p)
        next(p)
        e = parse_block_expr(p, Mutable)
        pushfirst!(e, kw)
        update_span!(e)
        e
    else make_id(p)
    end
end

function parse_import(p::Parser)
    kw = make_kw(p)
    t = is_import(kw) ? Import : Using
    x = parse_dot(p)
    if !is_comma(p.next) && !is_colon(p.next); e = Exp2(t, vcat(kw, x))
    elseif is_colon(p.next)
        e = Exp2(t, vcat(kw, x))
        push!(e, make_op(next(p)))
        x = parse_dot(p, true)
        append!(e, x)
        pos = position(p)
        while is_comma(p.next)
            use_comma(p, e)
            x = parse_dot(p, true)
            append!(e, x)
            pos = loop_check(p, pos)
        end
    else
        e = Exp2(t, vcat(kw, x))
        pos = position(p)
        while is_comma(p.next)
            use_comma(p, e)
            x = parse_dot(p)
            append!(e, x)
            pos = loop_check(p, pos)
        end
    end
    e
end

function parse_export(p::Parser)
    xs = Exp2[make_kw(p)]
    append!(xs, parse_dot(p))
    pos = position(p)
    while is_comma(p.next)
        push!(xs, make_punct(next(p)))
        x = parse_dot(p)[1]
        push!(xs, x)
        pos = loop_check(p, pos)
    end
    Exp2(Export, xs)
end

function parse_block_sig(p::Parser, h::Head)
    if h === Struct || h == Mutable || h === While; @nest p :ws parse_expr(p)
    elseif h === For; parse_iters(p)
    elseif h === FuncDef || h === Macro
        e = @nest p :inwhere @nest p :ws parse_expr(p)
        if is_sig_to_tuple(e); e = Exp2(TupleH, e.args) end
        pos = position(p)
        while p.next.kind === Scan.WHERE && p.ws.kind != Scan.NEWLINE_WS
            e = @nest p :inwhere @nest p :ws parse_where(p, e, make_one(next(p)), false)
            pos = loop_check(p, pos)
        end
        e
    elseif h === Let
        if is_eol_ws(p.ws); nothing
        else
            e = @nest p :comma @nest p :ws  parse_expr(p)
            if is_comma(p.next) || !(is_wrapped_assign(e) || is_id(e))
                e = Exp2(Block, Exp2[e])
                pos = position(p)
                while is_comma(p.next)
                    use_comma(p, e)
                    x = @nest p :comma @nest p :ws parse_expr(p)
                    push!(e, x)
                    pos = loop_check(p, pos)
                end
            end
            e
        end
    elseif h === Do
        e = Exp2(TupleH, Exp2[])
        pos = position(p)
        @nest p :comma @nest p :block while !is_nested(p)
            @nest p :ws a = parse_expr(p)
            push!(e, a)
            if p.next.kind === Scan.COMMA; use_comma(p, e)
            elseif @nest p :ws is_nested(p); break
            end
            pos = loop_check(p, pos)
        end
        e
    elseif h === ModuleH || h === BareModule
        is_id(p.next) ? make_id(next(p)) : @nest_rank p 15 @nest p :ws parse_expr(p)
    end
end

function parse_do(p::Parser, x::Exp2)
    e = parse_block_expr(next(p), Do)
    pushfirst!(e, x)
    update_span!(e)
    e
end

function parse_block_expr(p::Parser, h::Head)
    kw = make_kw(p)
    s = parse_block_sig(p, h)
    xs = parse_block(p, Exp2[], (Scan.END,), is_docable(h))
    if s === nothing; Exp2(h, Exp2[kw, Exp2(Block, xs), use_end(p)])
    elseif (h === FuncDef || h === Macro) && is_id_op_interp(s); Exp2(h, Exp2[kw, s, use_end(p)])
    else Exp2(h, Exp2[kw, s, Exp2(Block, xs), use_end(p)])
    end
end

function parse_if(p::Parser, nested=false)
    kw = make_kw(p)
    cond = is_eol_ws(p.ws) ? make_err(p, MissingCond) : @nest p :ws parse_expr(p)
    xs = parse_block(p, Exp2[], (Scan.END, Scan.ELSE, Scan.ELSEIF))
    e = nested ? Exp2(If, Exp2[cond, Exp2(Block, xs)]) : Exp2(If, Exp2[kw, cond, Exp2(Block, xs)])
    xs = Exp2[]
    if p.next.kind === Scan.ELSEIF
        push!(e, make_kw(next(p)))
        push!(xs, parse_if(p, true))
    end
    flag = p.next.kind === Scan.ELSE
    if p.next.kind === Scan.ELSE
        push!(e, make_kw(next(p)))
        parse_block(p, xs)
    end
    if !(isempty(xs) && !flag); push!(e, Exp2(Block, xs)) end
    !nested && use_end(p, e)
    e
end

function parse_try(p::Parser)
    kw = make_kw(p)
    e = Exp2(Try, Exp2[kw])
    xs = parse_block(p, Exp2[], (Scan.END, Scan.CATCH, Scan.FINALLY))
    push!(e, Exp2(Block, xs))
    if p.next.kind === Scan.CATCH
        next(p)
        push!(e, make_kw(p))
        if p.next.kind === Scan.FINALLY || p.next.kind === Scan.END
            caught = false_lit()
            b = Exp2(Block, Exp2[])
        else
            caught = is_eol_ws(p.ws) ? false_lit() : @nest p :ws parse_expr(p)
            xs = parse_block(p, Exp2[], (Scan.END, Scan.FINALLY))
            if !(is_id_op_interp(caught) || caught.kind === Scan.FALSE)
                pushfirst!(xs, caught)
                caught = false_lit()
            end
            b = Exp2(Block, xs)
        end
    else
        caught = false_lit()
        b = Exp2(Block, Exp2[])
    end
    push!(e, caught)
    push!(e, b)
    if p.next.kind === Scan.FINALLY
        if isempty(b.args); e.args[4] = setparent!(false_lit(), e) end
        push!(e, make_kw(next(p)))
        xs = parse_block(p)
        push!(e, Exp2(Block, xs))
    end
    push!(e, use_end(p))
    e
end
