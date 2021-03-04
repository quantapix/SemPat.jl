using Base.Meta: ParseError
using DataStructures: OrderedDict

strip_all(x) = strip_lines(x, recurse=true)
parse_fun(x) = parse_func(strip_all(x))

e = quote
    """Is nothing"""
  function f(x)::Bool
      isnothing(x)
  end
end

@testset "Morph" begin
@test (make_func(QFunc(:(f(x, y)))) == strip_all(:(function f(x, y) end)))
    @test (make_func(QFunc(:(f(x::Int, y::Int)), :Int)) == strip_all(:(function f(x::Int, y::Int)::Int end)))
    @test (make_func(QFunc(:(f(x)), :Bool, :(isnothing(x)))) == strip_all(:(function f(x)::Bool isnothing(x) end)))
    
@test (strip_all(make_func(QFunc(:(f(x)), :Bool, :(isnothing(x)), "Is nothing"))) == strip_all(e).args[1])
    
@test_throws ParseError parse_fun(:(f(x, y)))
@test (parse_fun(:(function f(x, y) x end)) == QFunc(:(f(x, y)), nothing, quote x end))
    
@test parse_fun((quote
  """ My docstring
  """
  function f(x, y) x end
end).args[1]) == QFunc(:(f(x, y)), nothing, quote x end, " My docstring\n")

@test (parse_fun(:(function f(x::Int, y::Int)::Int x end)) == QFunc(:(f(x::Int, y::Int)), :Int, quote x end))

@test (parse_fun(:(f(x, y) = x)) == QFunc(:(f(x, y)), nothing, quote x end))

s = QSig(:f, [:Int,:Int])
@test parse_sig(:(f(x::Int, y::Int))) == s
@test parse_sig(:(f(::Int, ::Int))) == s
@test parse_sig(:(f(x, y))) == QSig(:f, [:Any,:Any])

d = Dict((:r => :R, :s => :S, :t => :T))
@test replace_syms(d, :(foo(x::r, y::s)::t)) == :(foo(x::R, y::S)::T)
@test replace_syms(d, :(foo(xs::Vararg{r}))) == :(foo(xs::Vararg{R}))

@test GAT.parse_raw_expr(:(Ob)) == :Ob
@test GAT.parse_raw_expr(:(Hom(X, Y))) == :(Hom(X, Y))
@test_throws ParseError GAT.parse_raw_expr(:("Ob"))
@test_throws ParseError GAT.parse_raw_expr(:(Hom(X, 0)))

@test (GAT.parse_context(:((X::Ob, Y::Ob))) == GAT.Context((:X => :Ob, :Y => :Ob)))
@test (GAT.parse_context(:((X::Ob, Y::Ob, f::Hom(X, Y)))) == GAT.Context((:X => :Ob, :Y => :Ob, :f => :(Hom(X, Y)))))
@test GAT.parse_context(:(())) == GAT.Context()
@test_throws ParseError GAT.parse_context(:((X::Ob, X::Ob))) # Repeat variables

expr = :(Ob::TYPE)
cons = GAT.TypeConstructor(:Ob, [], GAT.Context())
@test GAT.parse_constructor(expr) == cons

expr = (quote "Object" Ob::TYPE end).args[2]
cons = GAT.TypeConstructor(:Ob, [], GAT.Context(), "Object")
@test GAT.parse_constructor(expr) == cons

expr = :(Hom(X, Y)::TYPE ⊣ (X::Ob, Y::Ob))
context = GAT.Context((:X => :Ob, :Y => :Ob))
cons = GAT.TypeConstructor(:Hom, [:X,:Y], context)
@test GAT.parse_constructor(expr) == cons

expr = :(unit()::Ob)
cons = GAT.TermConstructor(:unit, [], :Ob, GAT.Context())
@test GAT.parse_constructor(expr) == cons

expr = (quote "Monoidal unit" munit()::Ob end).args[2]

cons = GAT.TermConstructor(:munit, [], :Ob, GAT.Context(), "Monoidal unit")
    @test GAT.parse_constructor(expr) == cons

    cons = GAT.TermConstructor(:id, [:X], :(Hom(X, X)), GAT.Context(:X => :Ob))
    @test GAT.parse_constructor(:(id(X)::Hom(X, X) ⊣ (X::Ob))) == cons
    @test GAT.parse_constructor(:(id(X::Ob)::Hom(X, X))) == cons

    expr = :(compose(f, g)::Hom(X, Z) ⊣ (X::Ob, Y::Ob, Z::Ob, f::Hom(X, Y), g::Hom(Y, Z)))
    context = GAT.Context((:X => :Ob, :Y => :Ob, :Z => :Ob,
                       :f => :(Hom(X, Y)), :g => :(Hom(Y, Z))))
    cons = GAT.TermConstructor(:compose, [:f,:g], :(Hom(X, Z)), context)
    @test GAT.parse_constructor(expr) == cons
    expr = :(compose(f::Hom(X, Y), g::Hom(Y, Z))::Hom(X, Z) ⊣ (X::Ob, Y::Ob, Z::Ob))
    @test GAT.parse_constructor(expr) == cons

# Type transformations
    bindings = Dict((:Ob => :Obj, :Hom => :Mor))
    cons = GAT.TypeConstructor(:Hom, [:X,:Y],
  GAT.Context((:X => :Ob, :Y => :Ob)))
    target = GAT.TypeConstructor(:Mor, [:X,:Y],
  GAT.Context((:X => :Obj, :Y => :Obj)))
    @test GAT.replace_types(bindings, cons) == target

    cons = GAT.TermConstructor(:compose, [:f,:g], :(Hom(X, Z)),
  GAT.Context((:X => :Ob, :Y => :Ob, :Z => :Ob,
               :f => :(Hom(X, Y)), :g => :(Hom(Y, Z)))))
    target = GAT.TermConstructor(:compose, [:f,:g], :(Mor(X, Z)),
  GAT.Context((:X => :Obj, :Y => :Obj, :Z => :Obj,
               :f => :(Mor(X, Y)), :g => :(Mor(Y, Z)))))
    @test GAT.replace_types(bindings, cons) == target

    cons = GAT.AxiomConstructor(:(==), Meta.parse("compose(compose(f,g),Hom(C,D))"),
  Meta.parse("compose(f,compose(g,Hom(C,D)))"),
  GAT.Context((:A => :Ob, :B => :Ob, :C => :Ob, :D => :Ob,
               :f => :(Hom(A, B)), :g => :(Hom(B, C)))))
    target = GAT.AxiomConstructor(:(==), Meta.parse("compose(compose(f,g),Mor(C,D))"),
  Meta.parse("compose(f,compose(g,Mor(C,D)))"),
  GAT.Context((:A => :Obj, :B => :Obj, :C => :Obj, :D => :Obj, :f => :(Mor(A, B)), :g => :(Mor(B, C)))))
    
  @test GAT.replace_types(bindings, cons) == target

    cons = Dict(:→ => :Hom)
    target = Dict(:→ => :Mor)
    @test GAT.replace_types(bindings, cons) == target

    @test GAT.strip_type(:Ob) == :Ob
    @test GAT.strip_type(:(Hom(X, Y))) == :Hom
    @test GAT.strip_type(:(Hom(dual(X), dual(Y)))) == :Hom

    @test_throws ParseError try @eval @signature Category{Ob,Hom} begin
            Ob::TYPE
            Hom(dom, codom)::TYPE ⊣ (dom::Ob, codom::Ob)
            @op (→) := Hom

            id(X)::(X → X) ⊣ (X::Ob)
            compose(f, g)::(X → Z) ⊣ (X::Ob, Y::Ob, Z::Ob, f::(X → Y), g::(Y → Z))
            @op (⋅) := compose

            (f ⋅ g) ⋅ h == f ⋅ (g ⋅ h) ⊣ (A::Ob, B::Ob, C::Ob, D::Ob,
                                f::(A → B), g::(B → C), h::(C → D))
            f ⋅ id(B) == f ⊣ (A::Ob, B::Ob, f::(A → B))
            id(A) ⋅ f == f ⊣ (A::Ob, B::Ob, f::(A → B))
        end
    catch err;
        throw(err.error)
    end

@theory Category{Ob,Hom} begin
  Ob::TYPE
  Hom(dom, codom)::TYPE ⊣ (dom::Ob, codom::Ob)
  @op (→) := Hom

  id(X)::(X → X) ⊣ (X::Ob)
  compose(f, g)::(X → Z) ⊣ (X::Ob, Y::Ob, Z::Ob, f::(X → Y), g::(Y → Z))
  @op (⋅) := compose

  (f ⋅ g) ⋅ h == f ⋅ (g ⋅ h) ⊣ (A::Ob, B::Ob, C::Ob, D::Ob, f::(A → B), g::(B → C), h::(C → D))
  f ⋅ id(B) == f ⊣ (A::Ob, B::Ob, f::(A → B))
  id(A) ⋅ f == f ⊣ (A::Ob, B::Ob, f::(A → B))
end

@test Category isa Type
@test occursin("theory of categories", lowercase(string(Docs.doc(Category))))
@test isempty(methods(dom)) && isempty(methods(codom))
@test isempty(methods(id)) && isempty(methods(compose))

types = [
  GAT.TypeConstructor(:Ob, [], GAT.Context()),
  GAT.TypeConstructor(:Hom, [:dom,:codom], GAT.Context((:dom => :Ob, :codom => :Ob))),
]
terms = [
  GAT.TermConstructor(:id, [:X], :(Hom(X, X)), GAT.Context(:X => :Ob)),
  GAT.TermConstructor(:compose, [:f,:g], :(Hom(X, Z)),
    GAT.Context((:X => :Ob, :Y => :Ob, :Z => :Ob, :f => :(Hom(X, Y)), :g => :(Hom(Y, Z))))),
]
axioms = [
  GAT.AxiomConstructor(:(==), Meta.parse("compose(compose(f,g),h)"),
    Meta.parse("compose(f,compose(g,h))"),
    GAT.Context((:A => :Ob, :B => :Ob, :C => :Ob, :D => :Ob, :f => :(Hom(A, B)), :g => :(Hom(B, C)), :h => :(Hom(C, D))))),
  GAT.AxiomConstructor(:(==), Meta.parse("compose(f,id(B))"), :f, GAT.Context((:A => :Ob, :B => :Ob, :f => :(Hom(A, B))))),
  GAT.AxiomConstructor(:(==), Meta.parse("compose(id(A),f)"), :f, GAT.Context((:A => :Ob, :B => :Ob, :f => :(Hom(A, B))))),
]
aliases = Dict(:⋅ => :compose, :→ => :Hom)
category_theory = GAT.Theory(types, terms, axioms, aliases)

@test GAT.theory(Category) == category_theory

@theory CategoryAbbrev{Ob,Hom} begin
  @op begin
    (→) := Hom
    (⋅) := compose
  end

  Ob::TYPE
  Hom(dom::Ob, codom::Ob)::TYPE

  id(X::Ob)::(X → X)
  (compose(f::(X → Y), g::(Y → Z))::(X → Z)) where (X::Ob, Y::Ob, Z::Ob)

  (f ⋅ g) ⋅ h == f ⋅ (g ⋅ h) ⊣ (A::Ob, B::Ob, C::Ob, D::Ob, f::(A → B), g::(B → C), h::(C → D))
  f ⋅ id(B) == f ⊣ (A::Ob, B::Ob, f::(A → B))
  id(A) ⋅ f == f ⊣ (A::Ob, B::Ob, f::(A → B))
end

@test GAT.theory(CategoryAbbrev) == category_theory

accessors = [GAT.QFunc(:(dom(::Hom)), :Ob), GAT.QFunc(:(codom(::Hom)), :Ob)]
constructors = [GAT.QFunc(:(id(X::Ob)), :Hom), GAT.QFunc(:(compose(f::Hom, g::Hom)), :Hom)]
alias_functions = [
  GAT.QFunc(:(⋅(f::Hom, g::Hom)), :Hom, :(compose(f, g))),
  GAT.QFunc(:(→(dom::Ob, codom::Ob)), :Hom, :(Hom(dom, codom))),
]
theory = GAT.theory(Category)
@test GAT.accessors(theory) == accessors
@test GAT.constructors(theory) == constructors
@test GAT.alias_functions(theory) == alias_functions
@test GAT.interface(theory) == [accessors; constructors; alias_functions]

@signature Semigroup{S} begin
  S::TYPE
  times(x::S, y::S)::S
end

@signature MonoidExt{M} <: Semigroup{M} begin
  munit()::M
end

@test Semigroup isa Type && MonoidExt isa Type

theory = GAT.Theory(
  [GAT.TypeConstructor(:M, [], GAT.Context())],
  [GAT.TermConstructor(:times, [:x,:y], :M, GAT.Context((:x => :M, :y => :M))),
    GAT.TermConstructor(:munit, [], :M, GAT.Context())],
  [],
  Dict{Symbol,Symbol}()
)

@test GAT.theory(MonoidExt) == theory

theory = GAT.theory(Category)
context = GAT.Context((:X => :Ob, :Y => :Ob, :Z => :Ob, :f => :(Hom(X, Y)), :g => :(Hom(Y, Z))))
@test GAT.expand_in_context(:X, [:f,:g], context, theory) == :(dom(f))
@test (GAT.expand_in_context(:(Hom(X, Z)), [:f,:g], context, theory) == :(Hom(dom(f), codom(g))))

context = GAT.Context((:X => :Ob, :Y => :Ob, :Z => :Ob, :f => :(Hom(X, Y))))
@test_throws ErrorException GAT.expand_in_context(:W, [:f], context, theory)
@test_throws ErrorException GAT.expand_in_context(:Z, [:f], context, theory)

context = GAT.Context((:X => :Ob, :Y => :Ob, :f => :(Hom(X, Y))))
@test GAT.equations(context, theory) == [:(dom(f)) => :X, :(codom(f)) => :Y]
@test GAT.equations([:f], context, theory) == []

context = GAT.Context((:X => :Ob, :Y => :Ob, :Z => :Ob, :f => :(Hom(X, Y)), :g => :(Hom(Y, Z))))
@test (GAT.equations(context, theory) == [:(dom(f)) => :X, :(codom(f)) => :Y, :(dom(g)) => :Y, :(codom(g)) => :Z])
@test GAT.equations([:f,:g], context, theory) == [:(dom(g)) => :(codom(f))]

@instance Semigroup{Vector} begin
  times(x::Vector, y::Vector) = [x; y]
end

@test times([1,2], [3,4]) == [1,2,3,4]

@signature Monoid{M} begin
  M::TYPE
  munit()::M
  times(x::M, y::M)::M
end

# Incomplete instance of Monoid
# XXX: Cannot use `@test_warn` since generated code won't be at toplevel.
# @test_warn "not implemented" @instance Monoid{String} begin
#  times(x::AbsStringtractString, y::String) = string(x,y)
# end

@instance Monoid{String} begin
  munit(::Type{String}) = ""
  times(x::String, y::String) = string(x, y)
end

@test munit(String) == ""
@test times("a", "b") == "ab"

@test invoke_term(Monoid, (String,), :munit) == ""
@test invoke_term(Monoid, (String,), :times, "a", "b") == "ab"

end
