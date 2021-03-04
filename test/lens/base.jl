using StaticArrays
using StaticArrays: @SMatrix
using StaticNumbers

module Clone
    import ..Lens: make_set, make_lens, make_modify
    macro lens(e)
        make_lens(identity, e)
    end
    macro set(e)
        make_set(identity, e)
    end
    macro modify(f, e)
        make_modify(identity, f, e)
    end
end
using .Clone: Clone

==ₜ(_, _) = false
==ₜ(x::T, y::T) where T = x == y

function test_getset(lens, x, v1, v2)
  v = lens(x)
  @test set(x, lens, v) == x
  x1 = set(x, lens, v1)
  @test lens(x1) == v1
  x2 = set(x1, lens, v2)
  x3 = set(x2, lens, v2)
  @test x2 == x3
end

function test_modify(f, lens, x)
  x2 = modify(f, x, lens)
  v0 = lens(x)
  v = f(v0)
  x3 = set(x, lens, v)
  @test x2 == x3
end

@testset "Props" begin
    a = (x = 1, y = 2, z = 3)
    @test (x = 0, y = 1, z = 2) === @set a |> Props() -= 1
end
@testset "Elems" begin
    @test [0,0,0] == @set 1:3 |> Elems() = 0
    a = 1:3
    @test 2:4 == (@set a |> Elems() += 1)
    @test map(cos, a) == modify(cos, a, Elems())
    @test modify(cos, (), Elems()) === ()
    @inferred modify(cos, a, Elems())
    @inferred modify(cos, (), Elems())
end
@testset "Recursive" begin
    x = (a = 1, b = (1, 2), c = (A = 1, B = (1, 2, 3), D = 4))
    rp = Recursive(x -> !(x isa Tuple), Props())
    @test modify(collect, x, rp) == (a = 1, b = [1, 2], c = (A = 1, B = [1, 2, 3], D = 4))
    a = [1,2,[3,4], [5, 6:7,8, 9,]]
    oc = Recursive(x -> x isa AbstractArray, Elems())
    @test modify(x -> x - 1, a, oc) == [0,1,[2,3], [4, 5:6,7, 8,]]
end
@testset "If" begin
    @test 10 === @set(1 |> If(>=(0)) = 10)
    @test -1 === @set(-1 |> If(>=(0)) = 10)
    @inferred set(1, If(iseven), 2)
    @inferred modify(x -> 0, 1, If(iseven))
    a = 1:6
    @test [1, 0, 3, 0, 5, 0] == @set(a |> Elems() |> If(iseven) = 0)
    @inferred modify(x -> 0, a, @lens _ |> Elems() |> If(iseven))
end
dir = joinpath("./lens", "examples")
@testset "example $n" for n in readdir(dir)
    p = joinpath("./examples", n)
    include(p)
end
@testset "StaticArrays" begin
    x = StaticArrays.@SMatrix [1 2; 3 4]
    @testset for l in [
            (@lens _[2,1]),
        ]
        @test l(x) == 3
        @test set(x, l, 5) == StaticArrays.@SMatrix [1 2; 5 4]
        @test set_index(x, 5, 2, 1) == StaticArrays.@SMatrix [1 2; 5 4]
    end
    v = @SVector [1,2,3]
    @test (@set v[1] = 10) == @SVector [10,2,3]
    @test (@set v[1] = π) == @SVector [π,2,3]
    @testset "Multi-dynamic indexing" begin
        two = 2
        plusone(x) = x + 1
        l1 = @lens _.a[2, 1].b
        l2 = @lens _.a[plusone(end) - two, end ÷ 2].b
        m_orig = @SMatrix [
            (a = 1, b = 10) (a = 2, b = 20)
            (a = 3, b = 30) (a = 4, b = 40)
            (a = 5, b = 50) (a = 6, b = 60)
        ]
        m_mod = @SMatrix [
            (a = 1, b = 10) (a = 2, b = 20)
            (a = 3, b = 3000) (a = 4, b = 40)
            (a = 5, b = 50) (a = 6, b = 60)
        ]
        x = (a = m_orig, b = 4)
        @test l1(x) == l2(x) == 30
        @test set(x, l1, 3000) == set(x, l2, 3000) == (a = m_mod, b = 4)
    end
end
@testset "make_set, make_lens isolation" begin
    Clone.@lens(_                                         )
    Clone.@lens(_.a                                       )
    Clone.@lens(_[1]                                      )
    Clone.@lens(first(_)                                  )
    Clone.@lens(_[end]                                    )
    Clone.@lens(_[static(1)]                              )
    Clone.@lens(_.a[1][end, end - 2].b[static(1), static(1)])
    @test Lens.@lens(_.a) === Clone.@lens(_.a)
    @test Lens.@lens(_.a.b) === Clone.@lens(_.a.b)
    @test Lens.@lens(_.a.b[1,2]) === Clone.@lens(_.a.b[1,2])
    o = (a = 1, b = 2)
    @test Clone.@set(o.a = 2) === Lens.@set(o.a = 2)
    @test Clone.@set(o.a += 2) === Lens.@set(o.a += 2)
    @test Clone.@modify(x -> x + 1, o.a) === Lens.@modify(x -> x + 1, o.a)
    m = @SMatrix [0 0; 0 0]
    m2 = Clone.@set m[end - 1, end] = 1
    @test m2 == @SMatrix [0 1; 0 0]
    m3 = Clone.@set(first(m) = 1)
    @test m3 == @SMatrix[1 0; 0 0]
end
@testset "==ₜ" begin
    @test 1 ==ₜ 1
    @test !(1.0 ==ₜ 1)
end
@testset "set_index" begin
    a = [1,2,3]
    @test_throws MethodError Base.setindex(a, 10, 1)
    @test Lens.set_index(a, 10, 1) == [10, 2, 3]
    @test a == [1,2,3]
    @test @set(a[1] = 10) == [10, 2, 3]
    @test a == [1,2,3]
    @test Lens.set_index(a, 10.0, 1) ==ₜ Float64[10.0, 2.0, 3.0]
    d = Dict(:a => 1, :b => 2)
    @test_throws MethodError Base.setindex(d, 10, :a)
    @test Lens.set_index(d, 10, :a) == Dict(:a => 10, :b => 2)
    @test d == Dict(:a => 1, :b => 2)
    @test @set(d[:a] = 10) == Dict(:a => 10, :b => 2)
    @test d == Dict(:a => 1, :b => 2)
    @test Lens.set_index(d, 30, "c") ==ₜ Dict(:a => 1, :b => 2, "c" => 30)
    @test Lens.set_index(d, 10.0, :a) ==ₜ Dict(:a => 10.0, :b => 2.0)
end
@testset "os" begin
    p = "hello.md"
    p2 = @set splitext(p)[2] = ".jl"
    @test p2 == "hello.jl"
    p = joinpath("root", "somedir", "some.file")
    p2 = @set splitdir(p)[1] = "otherdir"
    @test p2 == joinpath("otherdir", "some.file")
    test_getset(splitext, "hello.world", ("hi", ".jl"), ("ho", ".md"))
    test_getset(splitdir, joinpath("hello", "world"), ("a", "b"), ("A", "B"))
    test_getset(splitpath, joinpath("hello", "world"), ["some"], ["some", "long", "path"])
    test_getset(dirname, joinpath("hello", "world"), "hi", "ho")
    test_getset(basename, joinpath("hello", "world"), "planet", "earth")
end
@testset "first" begin
    x = (1, 2.0, '3')
    l = @lens first(_)
    @test l === first
    @test l(x) === 1
    @test set(x, l, "1") === ("1", 2.0, '3')
    @test (@set first(x) = "1") === ("1", 2.0, '3')
    x2 = (a=((b=1,), 2), c=3)
    @test (@set first(x2.a).b = '1') === (a=((b='1',), 2), c=3)
end
@testset "last" begin
    x = (1, 2.0, '3')
    l = @lens last(_)
    @test l === last
    @test set(x, l, '4') === (1, 2.0, '4')
    @test (@set last(x) = '4') === (1, 2.0, '4')
    x2 = (a=(1, (b=2,)), c=3)
    @test (@set last(x2.a).b = '2') === (a=(1, (b='2',)), c=3)
end
@testset "eltype on Number" begin
    @test @set(eltype(Int) = Float32) === Float32
    @test @set(eltype(1.0) = UInt8)   === UInt8(1)
    @inferred set(Int, eltype, Float32)
    @inferred set(1.2, eltype, Float32)
end
@testset "eltype(::Type{<:Array})" begin
    x = Vector{Int}
    @inferred set(x, eltype, Float32)
    x2 = @set eltype(x) = Float64
    @test x2 === Vector{Float64}
end
@testset "eltype(::Array)" begin
    x = [1, 2, 3]
    @inferred set(x, eltype, Float32)
    x2 = @set eltype(x) = Float64
    @test eltype(x2) == Float64
    @test x == x2
end
@testset "(key|val|el)type(::Type{<:Dict})" begin
    x = Dict{Symbol, Int}
    @test (@set keytype(x) = String) === Dict{String, Int}
    @test (@set valtype(x) = String) === Dict{Symbol, String}
    @test (@set eltype(x) = Pair{String, Any}) === Dict{String, Any}
    x2 = Dict{Symbol, Dict{Int, Float64}}
    @test (@set keytype(valtype(x2)) = String) === Dict{Symbol, Dict{String, Float64}}
    @test (@set valtype(valtype(x2)) = String) === Dict{Symbol, Dict{Int, String}}
end
@testset "(key|val|el)type(::Dict)" begin
    x = Dict(1 => 2)
    @test typeof(@set keytype(x) = Float64) === Dict{Float64, Int}
    @test typeof(@set valtype(x) = Float64) === Dict{Int, Float64}
    @test typeof(@set eltype(x) = Pair{UInt, Float64}) === Dict{UInt, Float64}
end
@testset "math" begin
    x = 1
    @test 2.0       === @set real(1) = 2.0
    @test 1.0 + 2im === @set imag(1) = 2.0
    @test 1.0 + 2im === @set imag(1+1im) = 2.0
end
@testset "binary" begin
    @test tuple ∘ inv ===
          compose(tuple, inv) ===
          var"⨟"(inv, tuple) ===
          revcompose(inv, tuple)
end
@testset "unary" begin
    @test ∘(tuple) === compose(tuple) === var"⨟"(tuple) === revcompose(tuple) === tuple
end
@testset "⨟" begin
    @test tuple ∘ inv === inv ⨟ tuple
    @test ⨟(tuple) === revcompose(tuple)
end
@testset "all derived from ∘" begin
    @test compose   === (∘)
    @test revcompose === (⨟)
    struct FreeMagma
        word
    end
    FM = FreeMagma
    Base.:(∘)(a::FM, b::FM) = FM((a.word, b.word))
    @test_throws MethodError revcompose()
    @test_throws MethodError compose()
    @test revcompose(FM(1))                      === FM(1)
    @test revcompose(FM(1), FM(2))               === compose(FM(2), FM(1))               === FM((2,1))
    @test revcompose(FM(1), FM(2), FM(3))        === compose(FM(3), FM(2), FM(1))        === FM(((3,2),1))
    @test revcompose(FM(1), FM(2), FM(3), FM(4)) === compose(FM(4), FM(3), FM(2), FM(1)) === FM((((4,3),2),1))
    # test that revcompose(::Vararg{<:Any, N})
    # only depends on compose(::Vararg{<:Any, N})
    # for fixed N
    struct S end
    Base.:(∘)(::S) = 1
    Base.:(∘)(::S, ::S) = 2
    Base.:(∘)(::S, ::S, ::S) = 3
    Base.:(∘)(::S, ::S, ::S, ::S) = 4
    s = S()
    @test revcompose(s,         ) === 1
    @test revcompose(s, s,      ) === 2
    @test revcompose(s, s, s,   ) === 3
    @test revcompose(s, s, s, s,) === 4
end
@testset "inference" begin
    @inferred revcompose(sin)
    @inferred revcompose(sin, cos)
    @inferred revcompose(sin, cos, tan)
    @inferred revcompose(sin, cos, tan, cot)
    @inferred revcompose(sin, cos, tan, cot, exp)
end
