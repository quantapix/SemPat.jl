function format(p::AbstractPath, o::Opts=Opts())
    if isfile(p)
        extension(p) != "jl" && error("Only .jl files can be formatted")
        s = read(p, String)
        write(p, format(s, o))
    elseif exists(p)
        for p in walkpath(p)
            if extension(p) == "jl"; format(p, o)
            end
        end
    else error("Invalid path.")
    end
    nothing
end

function is_formatted(p::AbstractPath, o::Opts=Opts())
    if isfile(p)
        extension(p) != "jl" && error("Only .jl files can be formatted")
        s = read(p, String)
        s == format(s, o)
    elseif exists(p)
        for p in walkpath(p)
            if extension(p) == "jl"
                if !is_formatted(p, o); return false
                end
            end
        end
        true
    else error("Invalid path.")
    end
end

function format(s::AbstractString, o::Opts=Opts())
    t = deepcopy(s)
    old = JLParse.remlineinfo!(Meta.parse(string("begin\n", t, "\nend"), raise=false))
    if old.head == :error
        @warn ("Error in AST, original returned")
        return t
    end
    f = Formatter(0, Edit[], o, t, get_lines(t))
    e = JLParse.parse(t, true)
    if o.ops; pass(f, e, format_ops)
    end
    if o.tuples
        f.off = 0
        pass(f, e, format_tuples)
    end
    if o.curly
        f.off = 0
        pass(f, e, format_curly)
    end
    if o.calls
        f.off = 0
        pass(f, e, format_calls)
    end
    if o.iters
        f.off = 0
        pass(f, e, format_iters)
    end
    if o.comments
        format_comments(f, t)
    end
    if o.docs
        f.off = 0
        pass(f, e, format_docs)
    end
    if o.kws
        f.off = 0
        pass(f, e, format_kws)
    end
    if o.lineends
        format_lineends(f, t, e)
    end
    sort!(f.edits, lt=(a, b) -> first(a.loc) < first(b.loc), rev=true)
    for i = 1:length(f.edits)
        t = apply(f.edits[i], t)
    end
    if o.indents
        t = indents(t, f.opts)
    end
    ast = JLParse.remlineinfo!(Meta.parse(string("begin\n", t, "\nend"), raise=false))
    if ast.head == :error
        @warn ("Error in formatted AST, original returned")
        return s
    elseif old != ast
        @warn ("Formatted and original ASTs differ")
        return s
    end
    return t
end

function pass(f::Formatter, x, p=(f, x) -> nothing)
    p(f, x)
    if x.args isa Vector{Exp2}
        for a in x.args
            pass(f, a, p)
        end
    else f.off += x.fullspan
    end
    f
end

is_formatted(s::AbstractString, o::Opts=Opts()) = s == format(s, 0)

function apply(e::Edit{Int}, t)
    v = Vector{UInt8}(deepcopy(t))
    String(vcat(v[1:e.loc], Vector{UInt8}(e.text), v[e.loc + 1:end]))
end

function apply(e::Edit{UnitRange{Int}}, t)
    v = Vector{UInt8}(deepcopy(t))
    String(vcat(v[1:first(e.loc) - 1], Vector{UInt8}(e.text), v[last(e.loc) + 1:end]))
end
