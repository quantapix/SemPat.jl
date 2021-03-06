@testset_lifted "quick" begin
    @lift using SemPats.Utils: set_props
    @lift using SemPats.Match: construct, roottypeof, fieldsof, type_parameters, roottype, tuple_parameters, @d
    @lift abstract type Vehicle end

    @lift @qstruct Car{T <: Number,U}(size::T, nwheels::Int=4; manufacturer::U=nothing, brand::String="off-brand") <: Vehicle
    c = Car(10; manufacturer=("Danone", "Hershey"))
    @test c.size == 10
    @test c.nwheels == 4
    @test c.manufacturer == ("Danone", "Hershey")
    @test c.brand == "off-brand"
    c2 = @inferred set_props(c, (size = 42, nwheels = 8))
    @test c2.nwheels == 8
    @test c2.size == 42
    @test c2.brand == c.brand
    @test collect(fieldnames(Car)) == [:size, :nwheels, :manufacturer, :brand]
    @test construct(roottypeof(c), fieldsof(c)...) == c
    @test type_parameters(Vector{Int}) == Base.Core.svec(Int64, 1)
    @test tuple_parameters(Tuple{Int,Float64}) == Base.Core.svec(Int64, Float64)
    @inferred roottypeof(1 => 2) == Pair

    @lift @qstruct Empty()
    Empty()
    @test set_props(Empty(), NamedTuple()) === Empty()
    
    @lift @qstruct Blah{T}()

    @lift @qstruct Boring(x::Int)
    @inferred Boring(10)
    @test Boring(10).x == 10
    @test Boring(10.0).x == 10
    @lift @qstruct ParametricBoring{X}(x::X; _concise_show=true)
    @inferred ParametricBoring(10)
    @test ParametricBoring(10).x === 10
    o = ParametricBoring(1)
    @test set_props(o, x=:one).x === :one

    @lift @qstruct Kwaroo(x; y=10)
    @test Kwaroo(5) == Kwaroo(5; y=10)
    o = Kwaroo(5, y=10)
    o2 = @inferred set_props(o, (x = :five, y = 100.0))
    @test o2 isa Kwaroo
    @test o2.x === :five
    @test o2.y === 100.0

    @lift @qstruct Slurp(x, y=1, args...; kwargs...)
    s = Slurp(1, 2, 3, 4, 5, 6, 7; x=1, y=10 + 2)
    @test s.args == (3, 4, 5, 6, 7)
    @test s.kwargs == pairs((x = 1, y = 12))
    s2 = @inferred set_props(s, x=:hello)
    @test s2 isa Slurp
    @test s2.x == :hello
    @test s2.y == s.y

    let
        @unpack_Slurp Slurp(10)
        @test x == 10
        @test y == 1
    end

    @lift @qstruct SlurpParam{T}(x::AbstractVector{T}, y=1, args...; kwargs...)
    s = SlurpParam([1,2,3,4,5,6,7], 8, 9, 10; x=1, y=10 + 2)
    @test s.args == (9, 10)
    @test s.kwargs == pairs((x = 1, y = 12))

    @lift @qmutable Foo2{T}(x::T; y=2) do
        @assert x < 10
    end
    @test_throws AssertionError Foo2(11; y=10.0)
    @test_throws AssertionError construct(Foo2, 11, 10.0)

    @lift @qstruct_fp Plane(nwheels::Number; brand=:zoomba) do
        @assert nwheels < 100
    end <: Vehicle
    @test_throws MethodError Plane{Int,Symbol}(2; brand=12)
    @test Plane{Int,Symbol}(2; brand=:zoomba).brand == :zoomba
    @test supertype(Plane) == Vehicle
    @test_throws TypeError Plane("happy")

    @lift @qstruct_fp NoFields()

    o = Plane(4)
    o2 = @inferred set_props(o, brand=10, nwheels=o.nwheels)
    @test o2 isa Plane
    @test o2.brand === 10
    @test o2.nwheels === o.nwheels

    @lift @qstruct_fp Foo2_fp(a, b)
    @lift @qstruct_np Foo2_np(a, b)
    convert_f(foo) = convert(foo.a, 10)
    @test_throws(Exception, @inferred convert_f(Foo2_fp(Int, 2)))
    @inferred convert_f(Foo2_np(Int, 2))
    @test fieldtype(typeof(Foo2_np(Int, 2)), :a) == Type{Int64}

    @lift @qstruct Issue11(;no_default_value)
    @test_throws UndefKeywordError Issue11()

    @qfunctor function Action(a; kw=100)(x)
        a + x + kw
    end
    @test Action(2)(10) == 112

    @qfunctor ParamAction{X}(a::X)(b::T) where T = (a, b, X, T)
    @test ParamAction(1)(2.0) == (1, 2.0, Int, Float64)

    @destruct foo(Ref(x)) = x + 2
    @destruct foo(Ref{Float64}(x)) = x + 10
    @test foo(Ref(10)) == 12
    @test foo(Ref(10.0)) == 20
    @destruct foo(a, (Ref{T} where T)(x)) = a + x

    @lift struct LongerStruct{X}
        a
        b
        c::X
    end

    @destruct function kwfun(LongerStruct{X}(u, v; c, bof=b)) where X
        return u, v, c, bof
    end
    @test kwfun(LongerStruct(4, 5, 6)) == (4, 5, 6, 5)

    @destruct nested(LongerStruct(Ref(Ref(a)))) = a
    @test nested(LongerStruct(Ref(Ref(44)), 3, 4)) == 44

    @destruct tup_destruct(Ref((a, Ref(b)))) = (a, b)
    @test tup_destruct(Ref((1, Ref(2)))) == (1, 2)

    @d Ref(x) := Ref(111)
    @test x == 111
    
    @destruct for (LongerStruct(Ref(xx)), Ref(yy)) in [(LongerStruct(Ref(55), 10, 20), Ref(66))]
        @test (xx, yy) == (55, 66)
    end
    
    @d LongerStruct(x)(y) = (x, y)
    @test LongerStruct(10, 20, 30)(5) == (10, 5)
    
    @test @d((Ref(x), Ref(y)) -> x + 2)(Ref(10), Ref(20)) == 12
    
    @d with_type(Ref(a::Int)) = a
    @test with_type(Ref(1)) === 1
    @test with_type(Ref(2.0)) === 2
    
    @lift struct NotDestruct
        a
    end
    @lift @qstruct MyException()
    Match.check_destructurable(::NotDestruct) = throw(MyException())
    
    @d dontdestruct(NotDestruct(x)) = x
    @test_throws MyException dontdestruct(NotDestruct(x))
end
