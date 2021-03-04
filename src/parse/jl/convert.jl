import Core: Expr
using ..Scan: OP_REMAP

function norm_map(c::Int32, ::Ptr{Nothing})::Int32
    return c == 0x00B5 ? 0x03BC : # micro sign -> greek small letter mu
           c == 0x025B ? 0x03B5 : # latin small letter open e -> greek small letter
           c
end

function utf8proc_map_custom(s::String, opts, f)
    norm = @cfunction $f Int32 (Int32, Ptr{Nothing})
    w = ccall(:utf8proc_decompose_custom, Int, (Ptr{UInt8}, Int, Ptr{UInt8}, Int, Cint, Ptr{Nothing}, Ptr{Nothing}), s, sizeof(s), C_NULL, 0, opts, norm, C_NULL)
    w < 0 && Base.Unicode.utf8proc_error(w)
    buff = Base.StringVector(w * 4)
    w = ccall(:utf8proc_decompose_custom, Int, (Ptr{UInt8}, Int, Ptr{UInt8}, Int, Cint, Ptr{Nothing}, Ptr{Nothing}), s, sizeof(s), buff, w, opts, norm, C_NULL)
    w < 0 && Base.Unicode.utf8proc_error(w)
    b = ccall(:utf8proc_reencode, Int, (Ptr{UInt8}, Int, Cint), buff, w, opts)
    b < 0 && Base.Unicode.utf8proc_error(b)
    String(resize!(buff, b))
end

function norm_id(s::AbstractString)
    opts = Base.Unicode.UTF8PROC_STABLE | Base.Unicode.UTF8PROC_COMPOSE
    utf8proc_map_custom(String(s), opts, norm_map)
end

function sized_uint_lit(s::AbstractString, b::Integer)
    l = (sizeof(s) - 2) * b
    l <= 8   && return Base.parse(UInt8,   s)
    l <= 16  && return Base.parse(UInt16,  s)
    l <= 32  && return Base.parse(UInt32,  s)
    l <= 64  && return Base.parse(UInt64,  s)
    # l <= 128 && return Base.parse(UInt128, s)
    l <= 128 && return Expr(:macrocall, GlobalRef(Core, Symbol("@uint128_str")), nothing, s)
    Base.parse(BigInt, s)
end

function sized_uint_oct_lit(s::AbstractString)
    s[3] == 0 && return sized_uint_lit(s, 3)
    len = sizeof(s)
    (len < 5  || (len == 5  && s <= "0o377")) && return Base.parse(UInt8, s)
    (len < 8  || (len == 8  && s <= "0o177777")) && return Base.parse(UInt16, s)
    (len < 13 || (len == 13 && s <= "0o37777777777")) && return Base.parse(UInt32, s)
    (len < 24 || (len == 24 && s <= "0o1777777777777777777777")) && return Base.parse(UInt64, s)
    # (len < 45 || (len == 45 && s <= "0o3777777777777777777777777777777777777777777")) && return Base.parse(UInt128, s)
    # return Base.parse(BigInt, s)
    (len < 45 || (len == 45 && s <= "0o3777777777777777777777777777777777777777777")) && return Expr(:macrocall, GlobalRef(Core, Symbol("@uint128_str")), nothing, s)
    lisp_parse(s)
end

function lit_expr(e::Exp2)
    if e.kind === Scan.TRUE; true
    elseif e.kind === Scan.FALSE; false
    elseif is_nothing(e); nothing
    elseif e.kind === Scan.INTEGER || e.kind === Scan.BIN_INT || e.kind === Scan.HEX_INT || e.kind === Scan.OCT_INT; Expr_int(e)
    elseif e.kind === Scan.FLOAT; Expr_float(e)
    elseif e.kind === Scan.CHAR; Expr_char(e)
    elseif e.kind === Scan.MACRO; Symbol(val(e))
    elseif e.kind === Scan.STRING; val(e)
    elseif e.kind === Scan.STRING3; val(e)
    elseif e.kind === Scan.CMD; Expr_cmd(e)
    elseif e.kind === Scan.CMD3; Expr_tcmd(e)
    end
end

const TYPEMAX_INT64_STR = string(typemax(Int))
const TYPEMAX_INT128_STR = string(typemax(Int128))

function Expr_int(x)
    is_hex = is_oct = is_bin = false
    v = replace(val(x), "_" => "")
    if sizeof(v) > 2 && v[1] == '0'
        c = v[2]
        c == 'x' && (is_hex = true)
        c == 'o' && (is_oct = true)
        c == 'b' && (is_bin = true)
    end
    is_hex && return sized_uint_lit(v, 4)
    is_oct && return sized_uint_oct_lit(v)
    is_bin && return sized_uint_lit(v, 1)
    # sizeof(val) <= sizeof(TYPEMAX_INT64_STR) && return Base.parse(Int64, val)
    lisp_parse(v)
    # # val < TYPEMAX_INT64_STR && return Base.parse(Int64, val)
    # sizeof(val) <= sizeof(TYPEMAX_INTval < TYPEMAX_INT128_STR128_STR) && return Base.parse(Int128, val)
    # # val < TYPEMAX_INT128_STR && return Base.parse(Int128, val)
    # Base.parse(BigInt, val)
end
function Expr_float(x)
    if !startswith(val(x), "0x") && 'f' in val(x); return Base.parse(Float32, replace(val(x), 'f' => 'e'))
    end
    Base.parse(Float64, replace(val(x), "_" => ""))
end
function Expr_char(x)
    v = unescape(val(x)[2:prevind(val(x), lastindex(val(x)))])
    sizeof(v) == 1 && return Char(codeunit(v, 1))
    length(v) == 1 || error("Invalid character literal: $(Vector{UInt8}(val(x)))")
    v[1]
end

function Expr(x::Exp2)
    if is_id(x)
        if head(x) === NONSTDID; Symbol(norm_id(val(x.args[2])))
        else Symbol(norm_id(val(x)))
        end
    elseif is_kw(x)
        if x.kind === Scan.BREAK; Expr(:break)
        elseif x.kind === Scan.CONTINUE; Expr(:continue)
        else Symbol(lowercase(string(x.kind)))
        end
    elseif is_op(x)
        e = x.val isa String ? Symbol(val(x)) : OP_REMAP[x.kind]
        x.dot ? Symbol(:., e) : e
    elseif is_punct(x); string(x.kind)
    elseif is_lit(x); lit_expr(x)
    elseif is_uny_call(x); uny_expr(x)
    elseif is_biny_call(x); biny_expr(x)
    elseif is_where_call(x); where_expr(x)
    elseif head(x) === CondOpCall; Expr(:if, Expr(x.args[1]), Expr(x.args[3]), Expr(x.args[5]))
    elseif head(x) === ErrTok
        e = Expr(:error)
        if x.args !== nothing
            for a in x.args
                if !(is_punct(a)); push!(e.args, Expr(a))
                end
            end
        end
        e
    elseif head(x) === ChainOpCall
        e = Expr(:call, Expr(x.args[2]))
        for i = 1:length(x.args)
            if isodd(i); push!(e.args, Expr(x.args[i]))
            end
        end
        e
    elseif head(x) === Comparison
        e = Expr(:comparison)
        for a in x.args
            if !(is_punct(a)); push!(e.args, Expr(a))
            end
        end
        e
    elseif head(x) === ColonOpCall; Expr(:call, :(:), Expr(x.args[1]), Expr(x.args[3]), Expr(x.args[5]))
    elseif head(x) === Top
        e = Expr(:toplevel)
        for a in x.args
            if !(is_punct(a)); push!(e.args, Expr(a))
            end
        end
        e
    elseif head(x) === MacroName
        if is_id(x.args[2]); val(x.args[2]) == "." ? Symbol("@", "__dot__") : Symbol("@", val(x.args[2]))
        else is_op(x.args[2]) ? Symbol("@", Expr(x.args[2])) : Symbol("@")
        end
    elseif head(x) === MacroCall
        e = Expr(:macrocall)
        for a in x.args
            if !(is_punct(a)); push!(e.args, Expr(a))
            end
        end
        insert!(e.args, 2, nothing)
        if e.args[1] isa Expr && e.args[1].head == :. && string(e.args[1].args[2].value)[1] != '@'
            clear_at!(e.args[1])
            e.args[1].args[2] = QuoteNode(Symbol(string('@', e.args[1].args[2].value)))
        end
        e
    elseif head(x) === x_Str
        if is_biny_call(x.args[1]) && is_syntax_call(x.args[1].args[2])
            mname = Expr(x.args[1])
            mname.args[2] = QuoteNode(Symbol("@", mname.args[2].value, "_str"))
            e = Expr(:macrocall, mname, nothing)
        else e = Expr(:macrocall, Symbol("@", val(x.args[1]), "_str"), nothing)
        end
        for i = 2:length(x.args)
            push!(e.args, val(x.args[i]))
        end
        e
    elseif head(x) === x_Cmd
        e = Expr(:macrocall, Symbol("@", val(x.args[1]), "_cmd"), nothing)
        for i = 2:length(x.args)
            push!(e.args, val(x.args[i]))
        end
        e
    elseif head(x) === Quotenode; QuoteNode(Expr(x.args[end]))
    elseif head(x) === Call
        if x.args[1].kind === Scan.ISSUBTYPE || x.args[1].kind === Scan.ISSUPERTYPE
            e = Expr(Expr(x.args[1]))
            for i in 2:length(x.args)
                a = x.args[i]
                if head(a) === Params; insert!(e.args, 2, Expr(a))
                elseif !(is_punct(a)); push!(e.args, Expr(a))
                end
            end
            e
        else
            e = Expr(:call)
            for a in x.args
                if head(a) === Params; insert!(e.args, 2, Expr(a))
                elseif !(is_punct(a)); push!(e.args, Expr(a))
                end
            end
            e
        end
    elseif head(x) === Braces
        e = Expr(:braces)
        for a in x.args
            if head(a) === Params; insert!(e.args, 1, Expr(a))
            elseif !(is_punct(a)); push!(e.args, Expr(a))
            end
        end
        e
    elseif head(x) === BracesCat
        e = Expr(:bracescat)
        for a in x.args
            if head(a) === Params; insert!(e.args, 1, Expr(a))
            elseif !(is_punct(a)); push!(e.args, Expr(a))
            end
        end
        e
    elseif head(x) === Struct; Expr(:struct, false, Expr(x.args[2]), Expr(x.args[3]))
    elseif head(x) === Mutable; length(x.args) == 4 ? Expr(:struct, true, Expr(x.args[2]), Expr(x.args[3])) : Expr(:struct, true, Expr(x.args[3]), Expr(x.args[4]))
    elseif head(x) === Abstract; length(x.args) == 2 ? Expr(:abstract, Expr(x.args[2])) : Expr(:abstract, Expr(x.args[3]))
    elseif head(x) === Primitive; Expr(:primitive, Expr(x.args[3]), Expr(x.args[4]))
    elseif head(x) === FuncDef
        e = Expr(:function)
        for a in x.args
            if !(is_punct(a) || is_kw(a)); push!(e.args, Expr(a))
            end
        end
        e
    elseif head(x) === Macro
        if length(x.args) == 3; Expr(:macro, Expr(x.args[2]))
        else Expr(:macro, Expr(x.args[2]), Expr(x.args[3]))
        end
    elseif head(x) === ModuleH; Expr(:module, true, Expr(x.args[2]), Expr(x.args[3]))
    elseif head(x) === BareModule; Expr(:module, false, Expr(x.args[2]), Expr(x.args[3]))
    elseif head(x) === If; if_expr(x)
    elseif head(x) === Try
        e = Expr(:try)
        for a in x.args
            if !(is_punct(a) || is_kw(a)); push!(e.args, Expr(a))
            end
        end
        e
    elseif head(x) === Let; let_expr(x)
    elseif head(x) === Do; Expr(:do, Expr(x.args[1]), Expr(:->, Expr(x.args[3]), Expr(x.args[4])))
    elseif head(x) === Outer;  Expr(:outer, Expr(x.args[2]))
    elseif head(x) === For
        e = Expr(:for)
        if head(x.args[2]) === Block
            b = Expr(:block)
            for a in x.args[2].args
                if !(is_punct(a)); push!(b.args, fix_range(a))
                end
            end
            push!(e.args, b)
        else push!(e.args, fix_range(x.args[2]))
        end
        push!(e.args, Expr(x.args[3]))
        e
    elseif head(x) === While
        e = Expr(:while)
        for a in x.args
            if !(is_punct(a) || is_kw(a)); push!(e.args, Expr(a))
            end
        end
        e
    elseif is_tuple(x)
        e = Expr(:tuple)
        for a in x.args
            if head(a) == Params; insert!(e.args, 1, Expr(a))
            elseif !(is_punct(a)); push!(e.args, Expr(a))
            end
        end
        e
    elseif head(x) === Curly
        e = Expr(:curly)
        for a in x.args
            if head(a) === Params; insert!(e.args, 2, Expr(a))
            elseif !(is_punct(a)); push!(e.args, Expr(a))
            end
        end
        e
    elseif head(x) === Vect
        e = Expr(:vect)
        for a in x.args
            if head(a) === Params; pushfirst!(e.args, Expr(a))
            elseif !(is_punct(a)); push!(e.args, Expr(a))
            end
        end
        e
    elseif head(x) === Row
        e = Expr(:row)
        for a in x.args
            if !(is_punct(a)); push!(e.args, Expr(a))
            end
        end
        e
    elseif head(x) === Hcat
        e = Expr(:hcat)
        for a in x.args
            if !(is_punct(a)); push!(e.args, Expr(a))
            end
        end
        e
    elseif head(x) === Vcat
        e = Expr(:vcat)
        for a in x.args
            if !(is_punct(a)); push!(e.args, Expr(a))
            end
        end
        e
    elseif head(x) === Block
        e = Expr(:block)
        for a in x.args
            if !(is_punct(a)); push!(e.args, Expr(a))
            end
        end
        e
    elseif head(x) === Kw; Expr(:kw, Expr(x.args[1]), Expr(x.args[3]))
    elseif head(x) === Params
        e = Expr(:parameters)
        for a in x.args
            if head(a) === Params; insert!(e.args, 2, Expr(a))
            elseif !(is_punct(a)); push!(e.args, Expr(a))
            end
        end
        e
    elseif head(x) === Return
        e = Expr(:return)
        for i = 2:length(x.args)
            a = x.args[i]
            push!(e.args, Expr(a))
        end
        e
    elseif is_bracketed(x); Expr(x.args[2])
    elseif head(x) === Begin; Expr(x.args[2])
    elseif head(x) === Quote
        if length(x.args) == 1; Expr(:quote, Expr(x.args[1]))
        elseif is_bracketed(x.args[2]) && (is_op(x.args[2].args[2]) || is_lit(x.args[2].args[2]) || is_id(x.args[2].args[2])); QuoteNode(Expr(x.args[2]))
        else Expr(:quote, Expr(x.args[2]))
        end
    elseif head(x) === Global
        e = Expr(:global)
        if head(x.args[2]) === Const; e = Expr(:const, Expr(:global, Expr(x.args[2].args[2])))
        elseif length(x.args) == 2 && is_tuple(x.args[2])
            for a in x.args[2].args
                if !(is_punct(a)); push!(e.args, Expr(a))
                end
            end
        else
            for i = 2:length(x.args)
                a = x.args[i]
                push!(e.args, Expr(a))
            end
        end
        e
    elseif head(x) === Local
        e = Expr(:local)
        if head(x.args[2]) === Const; e = Expr(:const, Expr(:global, Expr(x.args[2].args[2])))
        elseif length(x.args) == 2 && is_tuple(x.args[2])
            for a in x.args[2].args
                if !(is_punct(a)); push!(e.args, Expr(a))
                end
            end
        else
            for i = 2:length(x.args)
                a = x.args[i]
                push!(e.args, Expr(a))
            end
        end
        e
    elseif head(x) === Const
        e = Expr(:const)
        for i = 2:length(x.args)
            a = x.args[i]
            push!(e.args, Expr(a))
        end
        e
    elseif head(x) === GlobalRefDoc; GlobalRef(Core, Symbol("@doc"))
    elseif head(x) === Ref
        e = Expr(:ref)
        for a in x.args
            if head(a) === Params; insert!(e.args, 2, Expr(a))
            elseif !(is_punct(a)); push!(e.args, Expr(a))
            end
        end
        e
    elseif head(x) === TypedHcat
        e = Expr(:typed_hcat)
        for a in x.args
            if !(is_punct(a)); push!(e.args, Expr(a))
            end
        end
        e
    elseif head(x) === TypedVcat
        e = Expr(:typed_vcat)
        for a in x.args
            if head(a) === Params; insert!(e.args, 2, Expr(a))
            elseif !(is_punct(a)); push!(e.args, Expr(a))
            end
        end
        e
    elseif head(x) === Compreh || head(x) === DictCompreh
        e = Expr(:comprehension)
        for a in x.args
            if !(is_punct(a)); push!(e.args, Expr(a))
            end
        end
        e
    elseif head(x) === Flatten
        iters, xs = get_inner_gen(x)
        i = popfirst!(iters)
        e = Expr(:generator, Expr(xs[1]), convert_iter_assign(i[1]))
        for i in iters
            if length(i) == 1
                e = Expr(:generator, e, convert_iter_assign(i[1]))
                e = Expr(:flatten, e)
            else
                e = Expr(:generator, e)
                for j in i
                    push!(e.args, convert_iter_assign(j))
                end
                e = Expr(:flatten, e)
            end
        end
        e
    elseif head(x) === Generator
        e = Expr(:generator, Expr(x.args[1]))
        for i = 3:length(x.args)
            a = x.args[i]
            if !(is_punct(a)); push!(e.args, convert_iter_assign(a))
            end
        end
        e
    elseif head(x) === Filter
        e = Expr(:filter)
        push!(e.args, Expr(last(x.args)))
        for i in 1:length(x.args) - 1
            a = x.args[i]
            if !(is_if(a) || is_punct(a)); push!(e.args, convert_iter_assign(a))
            end
        end
        e
    elseif head(x) === TypedCompreh
        e = Expr(:typed_comprehension)
        for a in x.args
            if !(is_punct(a)); push!(e.args, Expr(a))
            end
        end
        e
    elseif head(x) === Import; expr_import(x, :import)
    elseif head(x) === Using; expr_import(x, :using)
    elseif head(x) === Export
        e = Expr(:export)
        for i = 2:length(x.args)
            a = x.args[i]
            if !(is_punct(a)); push!(e.args, Expr(a))
            end
        end
        e
    elseif head(x) === FileH
        e = Expr(:file)
        for a in x.args
            push!(e.args, Expr(a))
        end
        e
    elseif head(x) === StringH
        e = Expr(:string)
        for (i, a) in enumerate(x.args)
            if is_uny_call(a); a = a.args[2]
            elseif is_lit(a) && a.kind === Scan.STRING && span(a) == 0 || ((i == 1 || i == length(x.args)) && span(a) == 1) || (val(a) === nothing || isempty(val(a)))
                continue
            else is_lit(a) && a.kind === Scan.STRING3 && span(a) == 0 || ((i == 1 || i == length(x.args)) && span(a) == 3) || (val(a) === nothing || isempty(val(a)))
            end
            push!(e.args, Expr(a))
        end
        e
    else
        e = Expr(:call)
        for a in x.args
            if !(is_punct(a)); push!(e.args, Expr(a))
            end
        end
        e
    end
end

function uny_expr(x)
    if is_op(x.args[1]) && is_syntax_uny_call(x.args[1]); Expr(Expr(x.args[1]), Expr(x.args[2]))
    elseif is_op(x.args[2]) && is_syntax_uny_call(x.args[2]); Expr(Expr(x.args[2]), Expr(x.args[1]))
    else Expr(:call, Expr(x.args[1]), Expr(x.args[2]))
    end
end

function biny_expr(x)
    if is_syntax_call(x.args[2]) && !(x.args[2].kind in (Scan.COLON,))
        if x.args[2].kind === Scan.DOT
            x1, x2 = Expr(x.args[1]), Expr(x.args[3])
            if x2 isa Expr && x2.head === :macrocall && endswith(string(x2.args[1]), "_cmd"); return Expr(:macrocall, Expr(:., x1, QuoteNode(x2.args[1])), nothing, x2.args[3])
            elseif x2 isa Expr && x2.head === :braces; return Expr(:., x1, Expr(:quote, x2))
            end
        end
        Expr(Expr(x.args[2]), Expr(x.args[1]), Expr(x.args[3]))
    else Expr(:call, Expr(x.args[2]), Expr(x.args[1]), Expr(x.args[3]))
    end
end

function where_expr(x)
    e = Expr(:where, Expr(x.args[1]))
    for i = 3:length(x.args)
        a = x.args[i]
        if head(a) === Params; insert!(e.args, 2, Expr(a))
        elseif !(is_punct(a) || is_kw(a)); push!(e.args, Expr(a))
        end
    end
    return e
end

Expr_cmd(x) = Expr(:macrocall, GlobalRef(Core, Symbol("@cmd")), nothing, val(x))
Expr_tcmd(x) = Expr(:macrocall, GlobalRef(Core, Symbol("@cmd")), nothing, val(x))

function clear_at!(x)
    if x isa Expr && x.head == :.
        if x.args[2] isa QuoteNode && string(x.args[2].value)[1] == '@'; x.args[2].value = Symbol(string(x.args[2].value)[2:end])
        end
        if x.args[1] isa Symbol && string(x.args[1])[1] == '@'; x.args[1] = Symbol(string(x.args[1])[2:end])
        else clear_at!(x.args[1])
        end
    end
end

function remlineinfo!(x)
    if isa(x, Expr)
        if x.head == :macrocall && x.args[2] !== nothing
            id = findall(map(x -> (isa(x, Expr) && x.head == :line) || (@isdefined(LineNumberNode) && x isa LineNumberNode), x.args))
            deleteat!(x.args, id)
            for j in x.args
                remlineinfo!(j)
            end
            insert!(x.args, 2, nothing)
        else
            id = findall(map(x -> (isa(x, Expr) && x.head == :line) || (@isdefined(LineNumberNode) && x isa LineNumberNode), x.args))
            deleteat!(x.args, id)
            for j in x.args
                remlineinfo!(j)
            end
        end
        if x.head == :elseif && x.args[1] isa Expr && x.args[1].head == :block && length(x.args[1].args) == 1
            x.args[1] = x.args[1].args[1]
        end
    end
    x
end

function if_expr(x)
    e = Expr(:if)
    iselseif = false
    n = length(x.args)
    i = 0
    while i < n
        i += 1
        a = x.args[i]
        if is_kw(a) && a.kind === Scan.ELSEIF
            i += 1
            r1 = Expr(x.args[i].args[1])
            push!(e.args, Expr(:elseif, r1.args...))
        elseif !(is_punct(a) || is_kw(a)); push!(e.args, Expr(a))
        end
    end
    e
end

function let_expr(x)
    e = Expr(:let)
    if length(x.args) == 3
        push!(e.args, Expr(:block))
        push!(e.args, Expr(x.args[2]))
        return e
    elseif head(x.args[2]) === Block
        arg = Expr(:block)
        for a in x.args[2].args
            if !(is_punct(a)); push!(arg.args, fix_range(a))
            end
        end
        push!(e.args, arg)
    else push!(e.args, fix_range(x.args[2]))
    end
    push!(e.args, Expr(x.args[3]))
    e
end

fix_range(x) = is_biny_call(x) && (is_in(x.args[2]) || is_elof(x.args[2])) ? Expr(:(=), Expr(x.args[1]), Expr(x.args[3])) : Expr(x)

function get_inner_gen(x, iters=[], xs=[])
    if head(x) == Flatten; get_inner_gen(x.args[1], iters, xs)
    elseif head(x) === Generator
        # push!(iters, get_iter(x))
        get_iters(x, iters)
        if head(x.args[1]) === Generator || head(x.args[1]) === Flatten; get_inner_gen(x.args[1], iters, xs)
        else push!(xs, x.args[1])
        end
    end
    return iters, xs
end

get_iter(x) = head(x) === Generator ? x.args[3] : nothing

function get_iters(x, iters)
    iters1 = []
    if head(x) === Generator
        # return x.args[3]
        for i = 3:length(x.args)
            if head(x.args[i]) !== PUNCT; push!(iters1, x.args[i])
            end
        end
    end
    push!(iters, iters1)
end

convert_iter_assign(a) = is_biny_call(a) && (is_in(a.args[2]) || is_elof(a.args[2])) ? Expr(:(=), Expr(a.args[1]), Expr(a.args[3])) : Expr(a)

function get_import_block(x, i, ret)
    while is_dot(x.args[i + 1])
        i += 1
        push!(ret.args, :.)
    end
    while i < length(x.args) && !(is_comma(x.args[i + 1]))
        i += 1
        a = x.args[i]
        if !(is_punct(a)) && !(is_dot(a) || is_colon(a)); push!(ret.args, Expr(a))
        end
    end
    i
end

function expr_import(x, kw)
    col = findall(a -> is_op(a) && rank(a) == ColonOp, x.args)
    comma = findall(is_comma, x.args)
    header = []
    xs = [Expr(:.)]
    i = 1
    while i < length(x.args)
        i += 1
        a = x.args[i]
        if is_colon(a)
            push!(header, popfirst!(xs))
            push!(xs, Expr(:.))
        elseif is_comma(a); push!(xs, Expr(:.))
        elseif !(is_punct(a)); push!(last(xs).args, Expr(a))
        end
    end
    isempty(header) ? Expr(kw, xs...) : Expr(kw, Expr(:(:), header..., xs...))
end
