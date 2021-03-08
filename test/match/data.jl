module M1; using SemPats.Match end
module M2; using SemPats.Match end

module Linq
select(arr, f) = map(f, arr)
end

@testset_lifted "data" begin
    @testset "subtying" begin
        @lift abstract type TestA{a} end
        @lift abstract type TestB{a} <: TestA{a} end
        @lift @data TestC{T} <: TestB{T} begin
            TestC_1(T, Int)
        end
        @test TestC_1(1, 2) isa TestC{Int}
    end
    @testset "list" begin
        @lift @data TestD{T} begin
            Nil()
            Cons(head::T, tail::TestD{T})
        end
        len(xs::TestD{T}) where T = @match xs begin
            Nil{T}() => 0
            Cons{T}(_, tail) => 1 + len(tail)
        end
        @test len(Nil{Any}()) == 0
        xs = Cons(3, Cons(2, Cons(1, Nil{Int}())))
        @test len(xs) == 3
    end
    @testset "arith" begin
        @lift @data TestE begin
            Num(v::Int)
            Minus(l::TestE, r::TestE)
            Add(l::TestE, r::TestE)
            Mult(l::TestE, r::TestE)
            Divide(l::TestE, r::TestE)
        end
        function eval_arith(x::TestE)
            @match x begin
                Num(v) => v
                Add(l, r) => eval_arith(l) + eval_arith(r)
                Minus(l, r) => eval_arith(l) - eval_arith(r)
                Mult(l, r) => eval_arith(l) * eval_arith(r)
                Divide(l, r) => eval_arith(l) / eval_arith(r)
            end
        end
        Number = Num
        @test eval_arith(
          Add(Number(1),
              Minus(Number(2),
                  Divide(Number(20),
                          Mult(Number(2),
                              Number(5)))))) == 1
    end
    @testset "case" begin
        @lift @data TestF begin
            TestF_1(a, b)
            TestF_2{T}::(a::Int, b::T) => TestF
        end
        @lift @data TestG begin
            TestG_1()
        end
        @test TestG_1 <: TestG
        @test fieldnames(TestF_1) == (:a, :b)
        @test_throws MethodError TestF_2(3.0, :abc)
    end
    @testset "share" begin
        @lift @data TestH begin
            TestH_1(Int)
        end
        using ..M1
        M1.eval(:(TestH_1 = $TestH_1; TestH = $TestH))
        @test M1.eval(quote
            @match TestH_1(2) begin
                TestH_1(_) => :ok
            end
        end) == :ok
        using ..M2
        M2.eval(:(TestH_1 = $TestH_1; TestH = $TestH))
        @test M2.eval(quote
            @match TestH_1(2) begin
                TestH_1(_) => :ok
            end
        end) == :ok
    end
    @testset "enum" begin
        @lift @data TestI{T} begin
            TestI_1::TestI{Int}
            TestI_2::TestI{Char}
        end
        @lift @data TestJ begin
            TestJ_1
            TestJ_2
        end
        e1 = TestI_1
        e2 = TestI_2
        e3 = TestJ_1
        e4 = TestJ_2
        @test @match 1 begin
            TestI_1 => false
            TestI_2 => false
            TestJ_1 => false
            TestJ_2 => false
            _ => true
        end
        @test @match TestI_1 begin
            TestI_1 => true
            _ => false
        end
        @test @match TestI_2 begin
            TestI_2 => true
            _ => false
        end
        @test @match TestJ_1 begin
            TestJ_1 => true
            _ => false
        end
        @test @match TestJ_2 begin
            TestJ_2 => true
            _ => false
        end
        @test @match TestI_1 begin
            TestI_2 => false 
            _ => true
        end
        @test @match TestJ_1 begin
            TestJ_2 => false 
            _ => true
        end
    end
    @testset "linq" begin
        @lift using ..Linq
        @lift macro linq(x)
            @match x begin
                :($s.$m($(xs...))) => let m = getfield(Linq, m); :($m($s, $(xs...))) end
                _ => @error "invalid"
            end
        end
        @lift @data TestK begin
            TestK_1(Int, Int)
            TestK_2(Float32)
        end
        @test (@linq [1, 2, 3].select(x -> x * 5)) == [5, 10,  15]
        @test (@linq [TestK_1(2, 2), TestK_2(3.9)].select(@λ begin
            TestK_1(a, b) -> a + b
            TestK_2(a) -> 3
        end)) == [4, 3]
    end
    @testset "destruct" begin
        @lift @data TestL{A,B} begin
            TestL_1{A,B}::(a::A, b::B) => TestL{A,B}
        end
        s = TestL_1(1, "2")
        @test @match s begin
            ::TestL{A,B} where {A,B} => A == Int && B == String
        end
        s = TestL_1(TestL_1(1, 2), "2")
        @match s begin
            ::TestL{String} => false
            ::TestL{A} where A => A <: TestL{Int,Int}
            _ => false
        end
        @test @match TestL_1(nothing, nothing) begin
            ::TestL{Int,Int} => false
            ::TestL{T} where T => T >: Nothing
            _ => false
        end
    end
    @testset "match" begin
        @lift @data TestM begin
            TestM_1(Int, Int)
            TestM_2(a::Float64, b::String)
        end
        a = TestM_1(1, 2)
        b = TestM_2(1.0, "2")
        @test @match a begin
            TestM_1(_) => true
            _ => false
        end
        @test @match a begin
            TestM_1(1, 2) => true
            _ => false
        end
        @test @match b begin
            TestM_2(1.0, "2") => true
            _ => false
        end
        @test @match a begin
            TestM_1(_2=2) => true
            _ => false
        end
        @test @match b begin
            TestM_2(a=1.0) => true
            _ => false
        end
    end
    @testset "gen match" begin
        @lift @data TestN{T} begin
            TestN_1{T,A}::(A, T) => TestN{T}
            TestN_2{T,B}::(a::T, b::B) => TestN{T}
        end
        @lift struct TestNN end
        a = TestN_1(1, TestNN())
        b = TestN_2([1], "2")
        @testset "spec" begin
            @test @match a begin
                TestN_1(_) => true
                _ => false
            end
            @test @match a begin
                TestN_1{TestNN,Int}(_) => true
                _ => false
            end
            @test @match b begin
                TestN_2{Vector{Int},String}(_) => true
                _ => false
            end
            @test @match b begin
                ::TestN{Vector{Int}} => true
                _ => false
            end
            @test @match a begin
                ::TestN{TestNN} => true
                _ => false
            end
            @test @match a begin
                TestN_1{TestNN}(_) => true
                _ => false
            end
        end
        @testset "gen" begin
            @test @match a begin
                TestN_1{T,A}(::A, ::T) where {A,T} => true
                _ => false
            end
            @test @match a begin
                TestN_1{TestNN,A}(_) where A <: Number => true
                _ => false
            end
            @test @match a begin
                TestN_1{TestNN}(_) => true
                _ => false
            end
            @test @match b begin
                TestN_2{A,B}(::B, ::A) where {A,B} => false
                TestN_2{A,B}(::A, ::B) where {A,B} => true
                _ => false
            end
        end
    end
    @testset "exception" begin
        @lift @data TestO begin
            TestO_1::Int => TestO
        end
        @test_macro_throws UndefVarError @match 1 begin
            Unknown(a, b) => 0
        end
        @test_macro_throws UndefVarError macroexpand(TestModule, :(@match 1 begin
            (a = b) => 0
        end))
        @test_macro_throws UndefVarError macroexpand(TestModule, :(@λ begin
            1 = 1
        end))
        @test_macro_throws UndefVarError macroexpand(TestModule, :(@match $TestO_1(1) begin
            TestO_1(b, c=a) => 1
        end))
        @test_macro_throws UndefVarError macroexpand(TestModule, :(@match 1 begin
            Int(x) => x
        end))
    end
end