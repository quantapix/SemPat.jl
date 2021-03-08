@testset_lifted "core" begin
    @lift using Polynomials
    @lift using LinearAlgebra
    @lift using SemPats.Trait
    @lift @trait Monoid{T} begin
        mempty::Type{T} => T
        (⊕)::[T, T] => T
    end
    @lift @impl Monoid{Int} begin
        mempty(_) = 0
        ⊕ = +
    end
    @lift @impl Monoid{Vector{T}} where T begin
        mempty(_) = T[]
        ⊕ = vcat
    end
    @lift @trait ToString{T} begin
        to_str::T => String
        to_str = Base.string
    end
    @impl ToString{T} where T
    @testset "simple" begin
        @test_throws Any begin
            "2" ⊕ "3"
        end
        @test 102 == begin
            100 ⊕ 2
        end
        @test [1, 2, 3, 3] == begin
            [1, 2] ⊕ [3, 3]
        end
        @test map(to_str, ["123", 10]) == map(string, ["123", 10])
    end
    @lift function vec_infer end
    @lift @trait Vect{S,V} where {S = vec_infer(V)} begin
        sca_mul::[S, V] => V
        sca_div::[V, S] => V
        vec_add::[V, V] => V
        vec_sub::[V, V] => V
        sca_add::[S, V] => V
        sca_sub::[V, S] => V
        sca_div(v::V, s::S) = sca_mul(one(S) / s, v)
        sca_sub(v::V, s::S) = sca_add(-s, v)
        vec_sub(v1::V, v2::V) = vec_add(v1, sca_mul(-one(S), v2))
    end
    @lift vec_infer(::Type{Polynomial{T}}) where T = T
    @lift @impl Vect{S,Polynomial{S}} where S <: Number begin
        sca_mul(s::S, v::Polynomial{S}) where S <: Number = s * v
        vec_add(v1::Polynomial{S}, v2::Polynomial{S}) where S <: Number = v1 + v2
        sca_add(s::S, v::Polynomial{S}) where S <: Number = s + v
    end
    @lift @trait Vect{S,V} >: Dot{S <: Number,V} where {S = vec_infer(V)} begin
        dot::[V, V] => S
        gram_schmidt::[V, Vector{V}] => V
        function gram_schmidt(v::V, vs::Vector{V})::V where S <: Number
            for x in vs
                c = dot(v, x) / dot(x, x)
                v = vec_sub(v, sca_mul(c, x))
            end
            sca_div(v, sqrt(dot(v, v)))
        end
    end
    @lift @impl Dot{F,Polynomial{F}} where F <: Number begin
        function dot(v1::Polynomial{F}, v2::Polynomial{F})::Real where F <: Number
            f = Polynomials.integrate(v1 * v2)
            f(1) - f(-1)
        end
    end
    @lift vec_infer(::Type{Tuple{F,F}}) where F <: Number = F
    @lift @impl Vect{F,Tuple{F,F}} where F <: Number begin
        sca_add(n, v) = (v[1] + n, v[2] + n)
        vec_add(v1, v2) = (v1[1] + v2[1], v1[2] + v2[2])
        sca_mul(n, v) = (n * v[1], n * v[2])
    end
    @lift @impl Dot{F,Tuple{F,F}} where F <: Number begin
        dot(v1, v2) = LinearAlgebra.dot(F[v1[1], v1[2]], F[v2[1], v2[2]])
    end
    @testset "orthogonal" begin
        @test sca_add(5.0, Polynomial([2.0, 1.0])) == Polynomial([7.0, 1.0])
        fx1 = Polynomial([1.0])
        fx2 = Polynomial([0.0, 1.0])
        T = typeof(fx1)
        fx1_ot = gram_schmidt(fx1, T[])
        fx2_ot = gram_schmidt(fx2, T[fx1_ot])
        @test dot(fx1_ot, fx2_ot) ≈ 0
        @test dot(fx1_ot, fx1_ot) ≈ 1
        @test dot(fx2_ot, fx2_ot) ≈ 1
        fx1 = (1.0, 2.0)
        fx2 = (3.0, 5.0)
        T = typeof(fx1)
        fx1_ot = gram_schmidt(fx1, T[])
        fx2_ot = gram_schmidt(fx2, T[fx1_ot])
        @test dot(fx1_ot, fx2_ot) + 1.0 ≈ 1.0
        @test dot(fx1_ot, fx1_ot) ≈ 1.0
        @test dot(fx2_ot, fx2_ot) ≈ 1.0
    end
    @lift function type_constr end
    @lift function type_arg end
    @lift function type_app end
    @lift struct App{Cons,K0}; injected end
    @lift @trait Higher{Cons,K0,K1} where {Cons = type_constr(K1),K0 = type_arg(K1),K1 = type_app(Cons, K0)} begin
        inj::K1 => App{Cons,K0}
        inj(x::K1) = App{Cons,K0}(x)
        prj::App{Cons,K0} => K1
        prj(x::App{Cons,K0})::K1 = x.injected
    end
    @lift abstract type HVect end
    @lift Base.@pure type_constr(::Type{Vector{T}}) where T = HVect
    @lift Base.@pure type_arg(::Type{Vector{T}}) where T = T
    @lift Base.@pure type_app(::Type{HVect}, ::Type{T}) where T = Vector{T}
    @lift @impl Higher{HVect,T,Vector{T}} where T
    @testset "higher" begin
        hv = inj([1, 2, 3])
        @test (hv |> typeof) == App{HVect,Int}
        @test prj(hv) == [1, 2, 3]
    end
    @lift @trait P{A} begin
        fx::A => Int
    end
    @lift @impl P{Symbol} begin
        fx(x) = 1
    end
    @lift @impl P{Tuple{T,T}} where T begin
        fx(x) = fx(x[1]) + fx(x[2])
    end
    @testset "mutual" begin
        @test fx(:a) == 1
        @test fx((:a, :b)) == 2
    end
    @lift @trait Add1{T <: Number} begin
        add1::[T] => T
    end
    @lift @impl Add1{Int} begin
        add1(x) = x + 1
    end
    #= 
    @lift @trait Add1{T} >: Addn{T <: Number} begin
        addn::[Int, T] => T
        addn(n, x) = let s = x; for i in 1:n; s = add1(s) end; s; end
    end
    @lift @impl Addn{Int}
    =#
    @testset "class inherit" begin
        @test add1(1) == 2
        #=
        @test addn(5, 1) == 6
        @test "Not impled trait Add1 for (Float64)." == try
            addn(2, 1.9)
            ""
        catch e
            strip(e.msg)
        end
        =#
    end
    #=
    @lift @impl! Add1{T} >: Add1{Vector{T}} where T begin
        add1(xs) = add1.(xs)
    end
    @testset "instance inherit" begin
        @test add1([1, 2, 3]) == [2, 3, 4]
        @test "Not impled trait Add1 for (Float64)." == try
            add1([1.])
        catch e
            strip(e.msg)
        end
    end
    =#
end