_lift = Symbol("@lift")

function lift!(e, es::Vector{Any})
    @switch e begin
        @case Expr(:macrocall, &_lift, _, x)
        push!(es, x)
        e.args[1] = Symbol("@static")
        e.args[3] = :(true ? true : true)
        @case Expr(a, xs...)
        for x in xs
            lift!(x, es)
        end
        @case _
        return
    end
end

macro testset_lifted(n, e)
    es = []
    lift!(e, es)
    m = gensym(n)
    __module__.eval(:(module $m
        using Test
        using SemPats.Match
        $(Symbol("@test_macro_throws")) = $(getfield(TestModule, Symbol("@test_macro_throws")))
        $(es...)
        @testset $n $e
        end))
end

macro test_macro_throws(t, x)
    :(@test_throws $t try
        @eval $x
    catch err
        while err isa LoadError
            err = err.error
        end
        throw(err)
    end)
end
