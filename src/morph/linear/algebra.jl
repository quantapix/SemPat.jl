import Base: adjoint

@theory LinearFunctions{Ob,Hom} <: SemiadditiveCategory{Ob,Hom} begin
    adjoint(f::(A → B))::(B → A) ⊣ (A::Ob, B::Ob)
  
    scalar(A::Ob, c::Number)::(A → A)
    antipode(A::Ob)::(A → A)

    scalar(A, a) ⋅ scalar(A, b) == scalar(A, a * b) ⊣ (A::Ob, a::Number, b::Number)
    scalar(A, 1) == id(A) ⊣ (A::Ob)
    scalar(A, a) ⋅ Δ(A) == Δ(A) ⋅ (scalar(A, a) ⊕ scalar(A, a)) ⊣ (A::Ob, a::Number)
    scalar(A, a) ⋅ ◊(A) == ◊(A) ⊣ (A::Ob, a::Number)
    Δ(A) ⋅ (scalar(A, a) ⊕ scalar(A, b)) ⋅ plus(A) == scalar(A, a + b) ⊣ (A::Ob, a::Number, b::Number)
    scalar(A, 0) == ◊(A) ⋅ zero(A) ⊣ (A::Ob)
    zero(A) ⋅ scalar(A, a) == zero(A) ⊣ (A::Ob, a::Number)
    antipode(A) == scalar(A, -1) ⊣ (A::Ob)

    scalar(A, c) ⋅ f == f ⋅ scalar(B, c) ⊣ (A::Ob, B::Ob, c::Number, f::(A → B))
end

@syntax FreeLinearFunctions{ObExpr,HomExpr} LinearFunctions begin
    oplus(A::Ob, B::Ob) = associate_unit(new(A, B), mzero)
    oplus(f::Hom, g::Hom) = associate(new(f, g))
    compose(f::Hom, g::Hom) = new(f, g; strict=true) # No normalization!
end

@theory LinearRelations{Ob,Hom} <: AbelianBicategoryRelations{Ob,Hom} begin
    adjoint(R::(A → B))::(B → A) ⊣ (A::Ob, B::Ob)

    scalar(A::Ob, c::Number)::(A → A)
    antipode(A::Ob)::(A → A)

  # Linearity axioms.
    plus(A) ⋅ R == (R ⊕ R) ⋅ plus(B) ⊣ (A::Ob, B::Ob, R::(A → B))
    zero(A) ⋅ R == zero(B) ⊣ (A::Ob, B::Ob, R::(A → B))
    scalar(A, c) ⋅ R == R ⋅ scalar(B, c) ⊣ (A::Ob, B::Ob, c::Number, R::(A → B))
end

@syntax FreeLinearRelations{ObExpr,HomExpr} LinearRelations begin
    oplus(A::Ob, B::Ob) = associate_unit(new(A, B), mzero)
    oplus(R::Hom, S::Hom) = associate(new(R, S))
    compose(R::Hom, S::Hom) = new(R, S; strict=true) # No normalization!
end

function evaluate_hom(f::FreeLinearFunctions.Hom{:gen}, xs::Vector; gens::AbstractDict=Dict())
    M = gens[f]
    x = reduce(vcat, xs; init=eltype(M)[])
    [ M * x ]
end

function evaluate_hom(f::FreeLinearFunctions.Hom{:plus}, xs::Vector; kw...)
    if first(f) isa ObExpr; [ reduce(+, xs) ]
    else
        mapreduce(+, args(f)) do g
            evaluate_hom(g, xs; kw...)
        end
    end
end
function evaluate_hom(f::FreeLinearFunctions.Hom{:zero}, xs::Vector; gens::AbstractDict=Dict())
    map(collect(codom(f))) do A
        dims = gens[A]
        zeros(dims...)
    end
end

evaluate_hom(f::FreeLinearFunctions.Hom{:scalar}, xs::Vector; kw...) = last(f) .* xs
evaluate_hom(f::FreeLinearFunctions.Hom{:antipode}, xs::Vector; kw...) = -1 .* xs

function __init__()
    @require LinearMaps = "7a12625a-238d-50fd-b39a-03d52299707e" begin
        include("LinearMapsExternal.jl")
    end
    @require LinearOperators = "5c8ed15e-5a4c-59e4-a42b-c7e8811fb125" begin
        include("LinearOperatorsExternal.jl")
    end
end
