using Base.Meta

function lisp_parse(s::AbstractString, pos::Int; greedy::Bool=true, raise::Bool=true)
    filename = "none"
    rule = greedy ? :statement : :atom
    e, pos = Core.Compiler.fl_parse(s, filename, pos - 1, rule)
    if raise && isa(e, Expr) && e.head === :error; throw(Meta.ParseError(e.args[1])) end
    if e === ()
        raise && throw(Meta.ParseError("end of input"))
        e = Expr(:error, "end of input")
    end
    e, pos + 1
end
function lisp_parse(s::AbstractString; raise::Bool=true)
    e, pos = lisp_parse(s, 1, greedy=true, raise=raise)
    (isa(e, Expr) && e.head === :error) && return e
    if !(pos > ncodeunits(s))
        raise && throw(Meta.ParseError("extra token after end"))
        e = Expr(:error, "extra token after end")
    end
    e
end
function lisp_parse(io::IO; greedy::Bool=true, raise::Bool=true)
    pos = position(io)
    e, d = lisp_parse(read(io, String), 1, greedy=greedy, raise=raise)
    seek(io, pos + d - 1)
    e
end

function norm_ast(x)
    if isa(x, Expr)
        for (i, a) in enumerate(x.args)
            x.args[i] = norm_ast(a)
        end
        x.head === :line && return Expr(:line, x.args[1], :none)
        if x.head === :macrocall
            f = x.args[1]
            f === Symbol("@int128_str") && return Base.parse(Int128, x.args[3])
            f === Symbol("@uint128_str") && return Base.parse(UInt128, x.args[3])
            f === Symbol("@bigint_str") && return  Base.parse(BigInt, x.args[3])
            if f == Symbol("@big_str")
                s = x.args[3]
                n = tryparse(BigInt, s)
                !(n === nothing) && return (n)
                n = tryparse(BigFloat, s)
                !(n === nothing) && return isnan((n)) ? :NaN : (n)
                return s
            end
        elseif length(x.args) >= 2 && isexpr(x, :call) && x.args[1] == :- && isa(x.args[2], Number); return -x.args[2]
        end
        return x
    end
    isa(x, QuoteNode) && return Expr(:quote, norm_ast(x.value))
    sa(x, AbstractFloat) && isnan(x) && return :NaN
    x
end

function lisp_parse_file(s, display=true)
    io = IOBuffer(s)
    failed = false
    e = Expr(:file)
    try
        while !is_eof(io)
            push!(e.args, lisp_parse(io))
        end
    catch err
        isa(err, InterruptException) && rethrow(err)
        if display
            Base.showerror(stdout, err, catch_backtrace())
            println()
        end
        e, true
    end
    if length(e.args) > 0  && e.args[end] === nothing; pop!(e.args) end
    e = norm_ast(e)
    remlineinfo!(e)
    e, false
end

function parse_file(s)
    e, p = JLParse.parse(Parser(s), true)
    sp = check_span(e)
    if length(e.args) > 0 && is_nothing(e.args[1]); popfirst!(e.args) end
    if length(e.args) > 0 && is_nothing(e.args[end]); pop!(e.args) end
    e = norm_ast(Expr(e))
    e, has_err(p), sp
end

function check_file(file, res, neq)
    s = read(file, String)
    e1, err, sp = parse_file(s)
    e2, _ = lisp_parse_file(s)
    print("\r                             ")
    if !isempty(sp)
        printstyled(file, color=:blue)
        @show sp
        println()
        push!(res, (file, :span))
    end
    if err
        printstyled(file, color=:yellow)
        println()
        push!(res, (file, :erred))
    elseif !(e1 == e2)
        cumfail = 0
        printstyled(file, color=:green)
        println()
        c0, c1 = JLParse.compare(e1, e2)
        printstyled(string("    ", c0), bold=true, color=:ligth_red)
        println()
        printstyled(string("    ", c1), bold=true, color=:light_green)
        println()
        push!(res, (file, :noteq))
    end
end

function check_base(dir=dirname(Base.find_source_file("essentials.jl")), display=false)
    c = 0
    neq = 0
    err = 0
    aerr = 0
    fail = 0
    bfail = 0
    res = []
    old = stderr
    redirect_stderr()
    for (rp, d, fs) in walkdir(dir)
        for f in fs
            file = joinpath(rp, f)
            if endswith(file, ".jl")
                c += 1
                try
                    print("\r", rpad(string(c), 5), rpad(string(round(fail / c * 100, sigdigits=3)), 8), rpad(string(round(err / c * 100, sigdigits=3)), 8), rpad(string(round(neq / c * 100, sigdigits=3)), 8))
                    check_file(file, res, neq)
                catch err
                    isa(err, InterruptException) && rethrow(err)
                    if display
                        Base.showerror(stdout, err, catch_backtrace())
                        println()
                    end
                    fail += 1
                    printstyled(file, color=:red)
                    println()
                    push!(res, (file, :failed))
                end
            end
        end
    end
    redirect_stderr(old)
    if bfail + fail + err + neq > 0
        println("\r$c files")
        printstyled("failed", color=:red)
        println(" : $fail    $(100 * fail / c)%")
        printstyled("erred", color=:yellow)
        println(" : $err     $(100 * err / c)%")
        printstyled("not eq.", color=:green)
        println(" : $neq    $(100 * neq / c)%", "  -  $aerr     $(100 * aerr / c)%")
        printstyled("base failed", color=:magenta)
        println(" : $bfail    $(100 * bfail / c)%")
        println()
    else println("\r")
    end
    res
end

function speed_test()
    dir = dirname(Base.find_source_file("essentials.jl"))
    println("speed test : ", @timed(for i = 1:5
        parse(read(joinpath(dir, "essentials.jl"), String), true);
        parse(read(joinpath(dir, "abstractarray.jl"), String), true);
    end)[2])
end


