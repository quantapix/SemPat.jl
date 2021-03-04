@testset "match" begin
    @testset "literal" begin
        @test @match 1 begin
            nothing => false
            _ => true
        end
        f(x) = @match x begin
            1 => "no"
            2 => "no"
            10 => "yes"
            _ => "none" end
        @test f(10) == "yes"
        @test f(1) == "no"
        @test f(0) == "none"
    end
    @testset "type" begin
        @test 1 == @match 1 begin
            ::Union{Int,String} => 1
            ::Int => 2
        end
        f(x) = @match x begin
            ::Float64 => nothing
            b::Int => b
            _ => nothing
        end
        @test f(3.0) === nothing
        @test f(3) == 3
        @test f("3") === nothing
    end
    @testset "as" begin
        f(x) = @match x begin
            (a, b) && c => c[1] == a && c[2] == b
        end
        @test f((:a, :b)) == true
        @test f((1, 2)) == true
    end
    @testset "or" begin
        function f(x)
            @match x begin
                1 || 2 => true
                _ => false
            end
        end
        @test f(1)
        @test f(2)
        @test !f(3)
        function g(x)
            @match x begin
                1 || [1 || 2] =>  true
                _ =>  false
            end
        end
        @test g(1)
        @test g([1])
        @test g([2])
        @test !g([1, 1])
    end
    @testset "guard" begin
        f(x) = @match x begin
            x && if x > 5 end => 5 - x
            _ => 1
        end
        @test f(0) == 1
        @test f(10) == -5
        g(x) = @match x begin
            x && if x > 0 end => x + 1
            x && if x < 0 end => x - 1
            _ => 0
        end
        @test g(0) == 0
        @test g(1) == 2
        @test g(-1) == -2
    end
    @testset "range" begin
        @test @match 1 begin
            a && 1:10 => a == 1
            _ => false
        end
        f(x) = @match x begin
            1:10  && x => "$x in [1, 10]"
            11:20 && x => "$x in [11, 20]"
            21:30 && x => "$x in [21, 30]"
        end
        @test f(3) == "3 in [1, 10]"
        @test f(13) == "13 in [11, 20]"
        @test f(23) == "23 in [21, 30]"
    end
    @testset "ref" begin
        c = "abc"
        f(x, y) = @match (x, y) begin
            (&c, _) => "x equals to c!"
            (_,  &c) => "y equals to c!"
            _ => "none of x and y equal to c"
        end
        @test f("abc", "def") == "x equals to c!"
        @test f("def", "abc") == "y equals to c!"
        @test f(0, 0) == "none of x and y equal to c"
    end
    @testset "string" begin
        function f(x::AbstractString)
            @match x begin
                "1" => 1
                _ => 0
            end
        end
        @test f("1") == 1
        @test f("11") == 0
        @test f(SubString("11", 2)) == 1
        @test f(SubString("11", 1)) == 0
    end
    @testset "dict" begin
        f(x) = @match x begin
            Dict("3" => four::Int,
            5 => Dict(6 => sev)) && if four < sev end => sev
        end
        @test f(Dict(1 => 2, "3" => 4, 5 => Dict(6 => 7))) == 7
    end
    @testset "tuple" begin
        @test 3 == @match (1, 2, 3) begin
            (1, 2, a) => a
        end
        @test (1, 2, 3, 4) == @match (1, 2, (3, 4, (5,))) begin
            (a, b, (c, d, (5,))) => (a, b, c, d)
        end
    end
    @testset "array" begin
        @test ([2], 3) == @match [1, 2, 3] begin
            [1, a..., b] => (a, b)
        end
        @test ([2, 3], 4) == @match [1, 2, 3, 4] begin
            [1, a..., b] => (a, b)
        end
        #= @test ([3, 2], 4) == @match [1 2; 3 4] begin
            [1, a..., b] => (a, b)
        end =#
        @test ([2, 3], 4) == @match [1, 2, 3, 4] begin
            [1, a..., b] => (a, b)
        end
        @test @match [1, [2, 3], (4, 5)] begin
            [1, [2, a], (b, 5), xs...] => a == 3 && b == 4 && isempty(xs)
        end

    end
    @testset "compr" begin
        @test [2, 3, 5] == @match [(1, 2), (2, 3), (3, 5)] begin
            [(_, x) for x in xs] => xs
            _ => nothing
        end
        @test [3, 5] == @match [(1, 2), (2, 3), (3, 5)] begin
            [(_, x) for x in xs if x > 2] => xs
            _ => nothing
        end
    end
    @testset "AST" begin
        function f(a)
            @match a begin
                :x => 0
                :(x + 1) => 1
                :(x + 2) => 2
                _ => 3
            end
        end
        @test f(:x) === 0
        @test f(:(x + 1)) === 1
        @test f(:(x + 2)) === 2
        @test f(:(x + 5)) === 3
        rm_lines(e::Expr) = Expr(e.head, filter((x) -> x !== nothing, map(rm_lines, e.args))...)
        rm_lines(::LineNumberNode) = nothing
        rm_lines(x) = x
        ex = quote
            function f(x, y=5); x + 1; x + 2; x + "3"; x + "4"; y + x end
        end
        @test  (1, 2, "3", "4", 5) == @match rm_lines(ex) begin
            quote
                function f(x, y=$default); x + $a; x + $b; x + $c; x + $d; y + x end
            end => (a, b, c, d, default)
        end
        ex = quote
            struct A{T} end
            struct B end
            struct C end
            struct D{G} end
        end
        @test [:(A{T}), :B, :C, :(D{G})] == @match rm_lines(ex) begin
            Do(ns=[]) && quote $(Many((:(struct $n end) || :(struct $n{$(_...)} end)) && Do(push!(ns, n)))...) end => ns
        end
    end
    @testset "manip" begin
        @test 1 == @matchast :(1 + 2) quote
            $a + 2 => a
        end
        @test (:f, [:a, :b, :c]) == @matchast :(f(a, b, c)) quote
            $g() => throw("not expected")
            $g($(xs...)) => (g, xs)
        end
        b = :(1 + 2)
        @test 1 == (@capture ($a + 2) b)[:a]
    end
    @testset "QuoteNode" begin
        function f(a)
            @match a begin
                QuoteNode(:($x + $y)) => (x, y)
                _ => nothing
            end
        end
        @test f(QuoteNode(:(x + 1))) === (:x, 1)
        @test f(QuoteNode(:(x + 2))) === (:x, 2)
        @test f(QuoteNode(1)) === nothing
        @test f(:x) === nothing
    end
    @testset "one-liner" begin
        @test (@match 1 1 => 2) == 2
        @test (@match [1, 2, 3] [x, xs...] => (x, xs)) == (1, [2,3])
    end
    u(x) = @cond begin
        x < 0 => -1
        x == 0 => 0
        x > 0 => 1
    end
    @testset "cond" begin
        @test u(-1) == -1
        @test u(-100) == -1
        @test u(1) == 1
        @test u(100) == 1
        @test u(0) == 0
        @test :a == @cond begin
            false => :b
            _ => :a
        end
    end
    @testset "expr" begin
        @test @match Expr(:f) begin
            Expr(a) => a === :f
            _  => false
        end
        @test @match Expr(:f) begin
            Expr(a...) => a == [:f]
            _ => false
        end
        @test @match Expr(:f, :a) begin
            Expr(a...) => a == [:f, :a]
            _ => false
        end
        @test @match Expr(:call, :f, :a) begin
            Expr(:call, xs...) => collect(xs) == [:f, :a]
        end
        ast = :(f(a, b))
        @test @match Expr(:call, :f, :a, :b) begin
            :($f($a, $b)) => (a, b) == (:a, :b)
        end
        x = :(function f(a, b, c); a + b + c end)
        @test @match x begin
            Expr(:function, Expr(:call, n, xs...), y) => begin
                (n, collect(xs)) == (:f, [:a, :b, :c]) &&
                  y.head == :block &&
                  y.args[1 + 1] isa LineNumberNode &&
                  y.args[2 + 1] == :(a + b + c)
            end
        end
        @test @match x begin
            :(function $n($(xs...)) $(y...) end) => begin
                (n, collect(xs)) == (:f, [:a, :b, :c]) &&
            y[1 + 1] isa LineNumberNode &&
            y[2 + 1] == :(a + b + c)
            end
        end
    end
    @testset "let" begin
        x = :(let a = 10 + 20, b = 20; 20a end)
        @test @match x begin
            :(let $b = $fn($l, $r), $(bs...)
                $(y...)
            end) => begin
                b == :a &&
                fn == :(+) &&
                l == 10 &&
                r == 20 &&
                y[1] isa LineNumberNode &&
                y[2] == :(20a)
            end
        end
    end
end
