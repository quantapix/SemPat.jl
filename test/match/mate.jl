import Base: ==

struct SM
    data::Vector{UInt8}
    SM(s) = new(codeunits(s))
end
==(x1::SM, x2::SM) = x1.data == x2.data

macro nothing_macro() end
macro splitjoin(x); esc(join_def(split_def(x))) end
macro zeroarg(); :(1) end
macro onearg(x); :(1 + $(esc(x))) end

@testset "mate" begin
    @testset "utils" begin
        @test @macroexpand(@nothing_macro) === nothing
        @test longdef(:(f(x)::Int = 10)).head == :function
        @test longdef(:(f(x::T) where U where T = 2)).head == :function
        @test shortdef(:(function f(x)::Int 10 end)).head != :function
        e1 = :(function foo(a) return a; end)
        @test Match.is_def(e1)
        e2 = :(function bar(a)::Int return 1; end)
        @test Match.is_def(e2)
        e3 = :(function foo(a::T) where T return a; end)
        @test Match.is_def(e3)
        e4 = :(function bar(a::T)::Int where T return 1; end)
        @test Match.is_def(e4)
        e5 = :(function bar(a::S, b::T)::Union{S,T} where {S,T} if rand() < 0.5 return a; end; return b; end)
        @test Match.is_def(e5)
        e6 = :(f(a) = a)
        @test Match.is_def(e6)
        e7 = :(f(a)::Int == 1)
        @test Match.is_def(e7)
        e8 = :(f(a::T) where T = a)
        @test Match.is_def(e8)
        e9 = :(f(a::T)::Int where T = 1)
        @test Match.is_def(e9)
        e10 = :(f(a::S, b::T)::Union{S,T} where {S,T} = rand() < 0.5 ? a : b)
        @test Match.is_def(e10)
    end 
    @testset "like" begin
        @test (2, 3) == @like :(2 + 3) begin
            (a_ + b_) => (a, b)
            (a_ - b_) => (b, a)
        end
        @test (3, 2) == @like :(2 - 3) begin
            (a_ + b_) => (a, b)
            (a_ - b_) => (b, a)
        end
        @test nothing === @like :(2 / 3) begin
            (a_ + b_) => (a, b)
            (a_ - b_) => (b, a)
        end
        @test :default == @like :(2 / 3) begin
            (a_ + b_) => (a, b)
            (a_ - b_) => (b, a)
            _ => :default
        end
    end
    @testset "struct" begin
        e = :(struct S end)
        @test e |> split_struct |> join_struct |> Base.remove_linenums! == :(struct S <: Any end)
        @test split_struct(e) == Dict(
            :constructors => Any[],
            :mutable => false,
            :params => Any[],
            :name => :S,
            :fields => Any[],
            :supertype => :Any)
        e = :(mutable struct T end)
        @test split_struct(e)[:mutable] === true
        @test e |> split_struct |> join_struct |> Base.remove_linenums! == :(mutable struct T <: Any end)
        e = :(struct S{A,B} <: AbstractS{B}
            a::A
        end)
        @test split_struct(e) == Dict(
            :constructors => Any[],
            :mutable => false,
            :params => Any[:A, :B],
            :name => :S,
            :fields => Any[(:a, :A)],
            :supertype => :(AbstractS{B}),)
        @test e |> split_struct |> join_struct |> Base.remove_linenums! == e |> Base.remove_linenums!
        e = :(struct S{A} <: Foo; S(a::A) where {A} = new{A}() end)
        @test e |> split_struct |> join_struct |> Base.remove_linenums! |> Match.flatten ==
        e |> Base.remove_linenums! |> Match.flatten
        cs = split_struct(e)[:constructors]
        @test length(cs) == 1
        @test first(cs) == :((S(a::A) where A) = new{A}()) |> Match.flatten
    end 
    @testset "destructure" begin
        d = @destructure [a, b] = Dict(:a => 1, :b => 2)
        @test d == Dict(:a => 1, :b => 2)
        @test (a, b) == (1, 2)
        @destructure [a] = Dict("a" => "foo")
        @test a == "foo"
        @destructure [foo = :a || 5, b = :b || 6, c || 7] = Dict(:a => 1)
        @test (foo, b, c) == (1, 6, 7)
        @destructure x.data = SM("foo")
        @test x == SM("foo")
        @test data == SM("foo").data
        @destructure _.(re, im) = Complex(1, 2)
        @test (re, im) == (1, 2)
        @destructure [s.data = :a] = Dict(:a => SM("foo"))
        @test s == SM("foo")
        @test data === s.data
        @destructure x[a, [c, d]=b] = Dict(:a => 1, :b => Dict(:c => 2, :d => 3))
        @test x == Dict(:a => 1, :b => Dict(:c => 2, :d => 3))
        @test (a, c, d) == (1, 2, 3)
        @test b == Dict(:c => 2, :d => 3)
    end
    @testset "split" begin
        let
            @test map(splitarg, (:(f(a=2, x::Int=nothing, y, args...))).args[2:end]) ==
                [(:a, :Any, false, 2), 
                 (:x, :Int, false, :nothing),
                 (:y, :Any, false, nothing), (:args, :Any, true, nothing)]
            @test splitarg(:(::Int)) == (nothing, :Int, false, nothing)
            @splitjoin foo(x) = x + 2
            @test foo(10) == 12
            @splitjoin add(a, b=2; c=3, d=4)::Float64 = a + b + c + d
            @test add(1; d=10) === 16.0
            @splitjoin fparam(a::T) where {T} = T
            @test fparam([]) == Vector{Any}
            struct Orange end
            @splitjoin (::Orange)(x) = x + 2
            @test Orange()(10) == 12
            @splitjoin fwhere(a::T) where T = T
            @test fwhere(10) == Int
            @splitjoin manywhere(x::T, y::Vector{U}) where T <: U where U = (T, U)
            @test manywhere(1, Number[2.0]) == (Int, Number)
            @splitjoin fmacro0() = @zeroarg
            @test fmacro0() == 1
            @splitjoin fmacro1() = @onearg 1
            @test fmacro1() == 2
            struct Foo{A,B}
                a::A
                b::B
            end
            @splitjoin Foo{A}(a::A) where A = Foo{A,A}(a, a)
            @test Foo{Int}(2) == Foo{Int,Int}(2, 2)
            @test (@splitjoin x -> x + 2)(10) === 12
            @test (@splitjoin (a, b = 2; c=3, d=4) -> a + b + c + d)(1; d=10) === 16
            @test (@splitjoin ((a, b)::Tuple{Int,Int} -> a + b))((1, 2)) == 3
            @test (@splitjoin ((a::T) where {T}) -> T)([]) === Vector{Any}
            @test (@splitjoin ((x::T, y::Vector{U}) where T <: U where U) -> (T, U))(1, Number[2.0]) == (Int, Number)
            @test (@splitjoin () -> @zeroarg)() == 1
            @test (@splitjoin () -> @onearg 1)() == 2
            @test (@splitjoin function (x) x + 2 end)(10) === 12
            @test (@splitjoin function (a::T) where {T} T end)([]) === Vector{Any}
            @test (@splitjoin function (x::T, y::Vector{U}) where T <: U where U
                (T, U)
            end)(1, Number[2.0]) == (Int, Number)
        end
    end
    let
        e = :(mutable struct Foo; x::Int; y end)
        @mate(e, mutable struct T_ fs__ end)
        @test T == :Foo
        @test fs == [:(x::Int), :y]
    end
    let
        e = :(f(x))
        @mate(e, f_(xs__))
        @test f == :f
        @test xs == [:x]
    end
    let
        e = :(f(x, y, z))
        @mate(e, f_(x_, xs__))
        @test f == :f
        @test x == :x
        @test xs == [:y, :z]
    end
    let
        e = quote; function foo(a, b); return a + b end end
        @test true === @mate(shortdef(e), f_(xs__) = body_)
    end
    let
        e = :(a = b)
        @mate(e, a_ = b_)
        @test (a, b) == (:a, :b)
    end
    let
        e = :(f(a=b))
        @mate(e, f(a_=b_))
        @test (a, b) == (:a, :b)
        @mate(e, f(x_))
        @test Match.is_expr(x, :kw)
    end
    let
        e = :(@foo(a,b))
        @mate(e, @foo(a_,b_))
        @test (a, b) == (:a, :b)
    end
    let
        e = :(sin(a, b))
        f = :sin
        @mate(e, $f(xs__))
        @test xs == [:a, :b]
    end
end
