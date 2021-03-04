module AST
test_fn1 = :(function f(a, b) a + b end)
test_fn2 = :(function f(a, b, c...) c end)
test_let = :(let x = a + b; 2x end)
test_chain = :(subject.method(arg1, arg2))
test_struct = :(struct name <: base; field1::Int; field2::Float32 end)
test_const = :(const a = value)
test_assign = :(a = b + c)
end

@testset "lambda" begin
    @testset "basic" begin
        xs = [(1, 2), (1, 3), (1, 4)]
        @test map((@λ (1, x) -> x), xs) == [2, 3, 4]
        @test (2, 3) |> @λ begin
            1 -> 2
            2 -> 7
            (a, b) -> (a + b) == 5
        end
        @test (2, 3) |> @λ (a, b) -> a == 2
        rm_lines = @λ begin
            e::Expr -> Expr(e.head, map(rm_lines, filter(x -> !(x isa LineNumberNode), e.args))...)
            a -> a
        end
        x = quote
            struct S{T}; a::Int; b::T end
        end |> rm_lines
        @test @match x begin
            quote
                struct $name{$tvar}; $f1::$t1; $f2::$t2 end
            end => quote
                struct $name{$tvar}; $f1::$t1; $f2::$t2 end
            end |> rm_lines == x
        end
    end
    @testset "case from Match.jl" begin
        rm_lines = @λ begin
            e::Expr -> Expr(e.head, filter(x -> x !== nothing, map(rm_lines, e.args))...)
            :: LineNumberNode -> nothing
            a -> a
        end
        @macroexpand(:(@match 1 begin
            1 => 1
        end)) |> rm_lines
        extract = @λ begin
            e::Symbol -> e
            Expr(:<:, a, _) -> extract(a)
            Expr(:struct, _, name, _) -> extract(name)
            Expr(:call, f, _...) -> extract(f)
            Expr(:., subject, attr, _...) -> extract(subject)
            Expr(:function, sig, _...) -> extract(sig)
            Expr(:const, assn, _...) -> extract(assn)
            Expr(:(=), fn, body, _...) -> extract(fn)
            Expr(t,  _...) -> error("Can't extract name from ", t, " expression: ", "$e\n")
        end
        @test extract(AST.test_fn1) == :f
        @test extract(AST.test_fn2) == :f
        @test extract(AST.test_chain) == :subject
        @test extract(AST.test_struct) == :name
        @test extract(AST.test_const) == :a
        @test extract(AST.test_assign) == :a
        @test extract(:(1 + 1)) == :+
    end
end
