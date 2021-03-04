@theory MonoidalCategory{Ob,Hom} <: Category{Ob,Hom} begin
    otimes(A::Ob, B::Ob)::Ob
    otimes(f::(A → B), g::(C → D))::((A ⊗ C) → (B ⊗ D)) ⊣
    (A::Ob, B::Ob, C::Ob, D::Ob)
    @op (⊗) := otimes
    munit()::Ob

  # Monoid axioms.
    (A ⊗ B) ⊗ C == A ⊗ (B ⊗ C) ⊣ (A::Ob, B::Ob, C::Ob)
    A ⊗ munit() == A ⊣ (A::Ob)
    munit() ⊗ A == A ⊣ (A::Ob)
    (f ⊗ g) ⊗ h == f ⊗ (g ⊗ h) ⊣ (A::Ob, B::Ob, C::Ob, X::Ob, Y::Ob, Z::Ob,
                                f::(A → X), g::(B → Y), h::(C → Z))

  # Functorality axioms.
    ((f ⊗ g) ⋅ (h ⊗ k) == (f ⋅ h) ⊗ (g ⋅ k)
    ⊣ (A::Ob, B::Ob, C::Ob, X::Ob, Y::Ob, Z::Ob,
       f::(A → B), h::(B → C), g::(X → Y), k::(Y → Z)))
    id(A ⊗ B) == id(A) ⊗ id(B) ⊣ (A::Ob, B::Ob)
end

@theory SymmetricMonoidalCategory{Ob,Hom} <: MonoidalCategory{Ob,Hom} begin
    braid(A::Ob, B::Ob)::((A ⊗ B) → (B ⊗ A))
    @op (σ) := braid

  # Involutivity axiom.
    σ(A, B) ⋅ σ(B, A) == id(A ⊗ B) ⊣ (A::Ob, B::Ob)

  # Coherence axioms.
    σ(A, B ⊗ C) == (σ(A, B) ⊗ id(C)) ⋅ (id(B) ⊗ σ(A, C)) ⊣ (A::Ob, B::Ob, C::Ob)
    σ(A ⊗ B, C) == (id(A) ⊗ σ(B, C)) ⋅ (σ(A, C) ⊗ id(B)) ⊣ (A::Ob, B::Ob, C::Ob)

  # Naturality axiom.
    (f ⊗ g) ⋅ σ(B, D) == σ(A, C) ⋅ (g ⊗ f) ⊣ (A::Ob, B::Ob, C::Ob, D::Ob,
                                          f::(A → B), g::(C → D))
end

@syntax FreeSymmetricMonoidalCategory{ObExpr,HomExpr} SymmetricMonoidalCategory begin
    otimes(A::Ob, B::Ob) = associate_unit(new(A, B), munit)
    otimes(f::Hom, g::Hom) = associate(new(f, g))
    compose(f::Hom, g::Hom) = associate(new(f, g; strict=true))
end

@theory MonoidalCategoryWithDiagonals{Ob,Hom} <: SymmetricMonoidalCategory{Ob,Hom} begin
    mcopy(A::Ob)::(A → (A ⊗ A))
    @op (Δ) := mcopy
    delete(A::Ob)::(A → munit())
    @op (◊) := delete

  # Commutative comonoid axioms.
    Δ(A) ⋅ (Δ(A) ⊗ id(A)) == Δ(A) ⋅ (id(A) ⊗ Δ(A)) ⊣ (A::Ob)
    Δ(A) ⋅ (◊(A) ⊗ id(A)) == id(A) ⊣ (A::Ob)
    Δ(A) ⋅ (id(A) ⊗ ◊(A)) == id(A) ⊣ (A::Ob)
    Δ(A) ⋅ σ(A, A) == Δ(A) ⊣ (A::Ob)

  # Coherence axioms.
    Δ(A ⊗ B) == (Δ(A) ⊗ Δ(B)) ⋅ (id(A) ⊗ σ(A, B) ⊗ id(B)) ⊣ (A::Ob, B::Ob)
    ◊(A ⊗ B) == ◊(A) ⊗ ◊(B) ⊣ (A::Ob, B::Ob)
    Δ(munit()) == id(munit())
    ◊(munit()) == id(munit())
end

@theory CartesianCategory{Ob,Hom} <: MonoidalCategoryWithDiagonals{Ob,Hom} begin
    pair(f::(A → B), g::(A → C))::(A → (B ⊗ C)) ⊣ (A::Ob, B::Ob, C::Ob)
    proj1(A::Ob, B::Ob)::((A ⊗ B) → A)
    proj2(A::Ob, B::Ob)::((A ⊗ B) → B)

  # Definitions of pairing and projections.
    pair(f, g) == Δ(C) ⋅ (f ⊗ g) ⊣ (A::Ob, B::Ob, C::Ob, f::(C → A), g::(C → B))
    proj1(A, B) == id(A) ⊗ ◊(B) ⊣ (A::Ob, B::Ob)
    proj2(A, B) == ◊(A) ⊗ id(B) ⊣ (A::Ob, B::Ob)
  
  # Naturality axioms.
    f ⋅ Δ(B) == Δ(A) ⋅ (f ⊗ f) ⊣ (A::Ob, B::Ob, f::(A → B))
    f ⋅ ◊(B) == ◊(A) ⊣ (A::Ob, B::Ob, f::(A → B))
end

@syntax FreeCartesianCategory{ObExpr,HomExpr} CartesianCategory begin
    otimes(A::Ob, B::Ob) = associate_unit(new(A, B), munit)
    otimes(f::Hom, g::Hom) = associate(new(f, g))
    compose(f::Hom, g::Hom) = associate(new(f, g; strict=true))

    pair(f::Hom, g::Hom) = compose(mcopy(dom(f)), otimes(f, g))
    proj1(A::Ob, B::Ob) = otimes(id(A), delete(B))
    proj2(A::Ob, B::Ob) = otimes(delete(A), id(B))
end

@signature MonoidalCategoryWithBidiagonals{Ob,Hom} <:
    MonoidalCategoryWithDiagonals{Ob,Hom} begin
    mmerge(A::Ob)::((A ⊗ A) → A)
    @op (∇) := mmerge
    create(A::Ob)::(munit() → A)
    @op (□) := create
end

@theory BiproductCategory{Ob,Hom} <: MonoidalCategoryWithBidiagonals{Ob,Hom} begin
    pair(f::(A → B), g::(A → C))::(A → (B ⊗ C)) ⊣ (A::Ob, B::Ob, C::Ob)
    copair(f::(A → C), g::(B → C))::((A ⊗ B) → C) ⊣ (A::Ob, B::Ob, C::Ob)
    proj1(A::Ob, B::Ob)::((A ⊗ B) → A)
    proj2(A::Ob, B::Ob)::((A ⊗ B) → B)
    coproj1(A::Ob, B::Ob)::(A → (A ⊗ B))
    coproj2(A::Ob, B::Ob)::(B → (A ⊗ B))
  
  # Naturality axioms.
    f ⋅ Δ(B) == Δ(A) ⋅ (f ⊗ f) ⊣ (A::Ob, B::Ob, f::(A → B))
    f ⋅ ◊(B) == ◊(A) ⊣ (A::Ob, B::Ob, f::(A → B))
    ∇(A) ⋅ f == (f ⊗ f) ⋅ ∇(B) ⊣ (A::Ob, B::Ob, f::(A → B))
    □(A) ⋅ f == □(B) ⊣ (A::Ob, B::Ob, f::(A → B))
  
  # Bimonoid axioms. (These follow from naturality + coherence axioms.)
    ∇(A) ⋅ Δ(A) == (Δ(A) ⊗ Δ(A)) ⋅ (id(A) ⊗ σ(A, A) ⊗ id(A)) ⋅ (∇(A) ⊗ ∇(A)) ⊣ (A::Ob)
    ∇(A) ⋅ ◊(A) == ◊(A) ⊗ ◊(A) ⊣ (A::Ob)
    □(A) ⋅ Δ(A) == □(A) ⊗ □(A) ⊣ (A::Ob)
    □(A) ⋅ ◊(A) == id(munit()) ⊣ (A::Ob)
end

@syntax FreeBiproductCategory{ObExpr,HomExpr} BiproductCategory begin
    otimes(A::Ob, B::Ob) = associate_unit(new(A, B), munit)
    otimes(f::Hom, g::Hom) = associate(new(f, g))
    compose(f::Hom, g::Hom) = associate(new(f, g; strict=true))

    pair(f::Hom, g::Hom) = Δ(dom(f)) ⋅ (f ⊗ g)
    copair(f::Hom, g::Hom) = (f ⊗ g) ⋅ ∇(codom(f))
    proj1(A::Ob, B::Ob) = id(A) ⊗ ◊(B)
    proj2(A::Ob, B::Ob) = ◊(A) ⊗ id(B)
    coproj1(A::Ob, B::Ob) = id(A) ⊗ □(B)
    coproj2(A::Ob, B::Ob) = □(A) ⊗ id(B)
end

@signature ClosedMonoidalCategory{Ob,Hom} <: SymmetricMonoidalCategory{Ob,Hom} begin
  # Internal hom of A and B, an object representing Hom(A,B)
    hom(A::Ob, B::Ob)::Ob

  # Evaluation map
    ev(A::Ob, B::Ob)::((hom(A, B) ⊗ A) → B)

  # Currying (aka, lambda abstraction)
    curry(A::Ob, B::Ob, f::((A ⊗ B) → C))::(A → hom(B, C)) ⊣ (C::Ob)
end

@syntax FreeClosedMonoidalCategory{ObExpr,HomExpr} ClosedMonoidalCategory begin
    otimes(A::Ob, B::Ob) = associate_unit(new(A, B), munit)
    otimes(f::Hom, g::Hom) = associate(new(f, g))
    compose(f::Hom, g::Hom) = associate(new(f, g; strict=true))
end

@signature CartesianClosedCategory{Ob,Hom} <: CartesianCategory{Ob,Hom} begin
    hom(A::Ob, B::Ob)::Ob
    ev(A::Ob, B::Ob)::((hom(A, B) ⊗ A) → B)
    curry(A::Ob, B::Ob, f::((A ⊗ B) → C))::(A → hom(B, C)) ⊣ (C::Ob)
end

@syntax FreeCartesianClosedCategory{ObExpr,HomExpr} CartesianClosedCategory begin
    otimes(A::Ob, B::Ob) = associate_unit(new(A, B), munit)
    otimes(f::Hom, g::Hom) = associate(new(f, g))
    compose(f::Hom, g::Hom) = associate(new(f, g; strict=true))

    pair(f::Hom, g::Hom) = Δ(dom(f)) ⋅ (f ⊗ g)
    proj1(A::Ob, B::Ob) = id(A) ⊗ ◊(B)
    proj2(A::Ob, B::Ob) = ◊(A) ⊗ id(B)
end

@theory CompactClosedCategory{Ob,Hom} <: ClosedMonoidalCategory{Ob,Hom} begin
  # Dual A^* of object A
    dual(A::Ob)::Ob

  # Unit of duality, aka the coevaluation map
    dunit(A::Ob)::(munit() → (dual(A) ⊗ A))

  # Counit of duality, aka the evaluation map
    dcounit(A::Ob)::((A ⊗ dual(A)) → munit())

  # Adjoint mate of morphism f.
    mate(f::(A → B))::(dual(B) → dual(A)) ⊣ (A::Ob, B::Ob)
  
  # Axioms for closed monoidal structure.
    hom(A, B) == B ⊗ dual(A) ⊣ (A::Ob, B::Ob)
    ev(A, B) == id(B) ⊗ (σ(dual(A), A) ⋅ dcounit(A)) ⊣ (A::Ob, B::Ob)
    (curry(A, B, f) == (id(A) ⊗ (dunit(B) ⋅ σ(dual(B), B))) ⋅ (f ⊗ id(dual(B)))
   ⊣ (A::Ob, B::Ob, C::Ob, f::((A ⊗ B) → C)))
end

@syntax FreeCompactClosedCategory{ObExpr,HomExpr} CompactClosedCategory begin
    dual(A::Ob) = distribute_unary(involute(new(A)), dual, otimes,
                                 unit=munit, contravariant=true)
    otimes(A::Ob, B::Ob) = associate_unit(new(A, B), munit)
    otimes(f::Hom, g::Hom) = associate(new(f, g))
    compose(f::Hom, g::Hom) = associate(new(f, g; strict=true))
    mate(f::Hom) = distribute_mate(involute(new(f)))
    hom(A::Ob, B::Ob) = B ⊗ dual(A)
    ev(A::Ob, B::Ob) = id(B) ⊗ (σ(dual(A), A) ⋅ dcounit(A))
    curry(A::Ob, B::Ob, f::Hom) =
    (id(A) ⊗ (dunit(B) ⋅ σ(dual(B), B))) ⋅ (f ⊗ id(dual(B)))
end

@signature DaggerCategory{Ob,Hom} <: Category{Ob,Hom} begin
    dagger(f::(A → B))::(B → A) ⊣ (A::Ob, B::Ob)
end

@syntax FreeDaggerCategory{ObExpr,HomExpr} DaggerCategory begin
    compose(f::Hom, g::Hom) = associate(new(f, g; strict=true))
    dagger(f::Hom) = distribute_dagger(involute(new(f)))
end

@signature DaggerSymmetricMonoidalCategory{Ob,Hom} <: SymmetricMonoidalCategory{Ob,Hom} begin
    dagger(f::(A → B))::(B → A) ⊣ (A::Ob, B::Ob)
end

@syntax FreeDaggerSymmetricMonoidalCategory{ObExpr,HomExpr} DaggerSymmetricMonoidalCategory begin
    otimes(A::Ob, B::Ob) = associate_unit(new(A, B), munit)
    otimes(f::Hom, g::Hom) = associate(new(f, g))
    compose(f::Hom, g::Hom) = associate(new(f, g; strict=true))
    dagger(f::Hom) = distribute_unary(distribute_dagger(involute(new(f))),
                                    dagger, otimes)
end

@signature DaggerCompactCategory{Ob,Hom} <: CompactClosedCategory{Ob,Hom} begin
    dagger(f::(A → B))::(B → A) ⊣ (A::Ob, B::Ob)
end

@syntax FreeDaggerCompactCategory{ObExpr,HomExpr} DaggerCompactCategory begin
    dual(A::Ob) = distribute_unary(involute(new(A)), dual, otimes,
                                 unit=munit, contravariant=true)
    otimes(A::Ob, B::Ob) = associate_unit(new(A, B), munit)
    otimes(f::Hom, g::Hom) = associate(new(f, g))
    compose(f::Hom, g::Hom) = associate(new(f, g; strict=true))
    dagger(f::Hom) = distribute_unary(distribute_dagger(involute(new(f))),
                                    dagger, otimes)
    mate(f::Hom) = distribute_mate(involute(new(f)))
end

@signature TracedMonoidalCategory{Ob,Hom} <: SymmetricMonoidalCategory{Ob,Hom} begin
    trace(X::Ob, A::Ob, B::Ob, f::((X ⊗ A) → (X ⊗ B)))::(A → B)
end

@syntax FreeTracedMonoidalCategory{ObExpr,HomExpr} TracedMonoidalCategory begin
    otimes(A::Ob, B::Ob) = associate_unit(new(A, B), munit)
    otimes(f::Hom, g::Hom) = associate(new(f, g))
    compose(f::Hom, g::Hom) = associate(new(f, g; strict=true))
  # FIXME: `GAT.equations` fails to identify the codeicit equation.
  # trace(X::Ob, A::Ob, B::Ob, f::Hom) = new(X,A,B,f; strict=true)
end

@theory HypergraphCategory{Ob,Hom} <: MonoidalCategoryWithBidiagonals{Ob,Hom} begin
  # Self-dual compact closed category.
    dunit(A::Ob)::(munit() → (A ⊗ A))
    dcounit(A::Ob)::((A ⊗ A) → munit())
    dagger(f::(A → B))::(B → A) ⊣ (A::Ob, B::Ob)

    dunit(A) == create(A) ⋅ mcopy(A) ⊣ (A::Ob)
    dcounit(A) == mmerge(A) ⋅ delete(A) ⊣ (A::Ob)
    (dagger(f) == (id(Y) ⊗ dunit(X)) ⋅ (id(Y) ⊗ f ⊗ id(X)) ⋅ (dcounit(Y) ⊗ id(X))
   ⊣ (A::Ob, B::Ob, f::(A → B)))
end

@syntax FreeHypergraphCategory{ObExpr,HomExpr} HypergraphCategory begin
    otimes(A::Ob, B::Ob) = associate_unit(new(A, B), munit)
    otimes(f::Hom, g::Hom) = associate(new(f, g))
    compose(f::Hom, g::Hom) = associate(new(f, g; strict=true))
    dagger(f::Hom) = distribute_unary(distribute_dagger(involute(new(f))),
                                    dagger, otimes)
end

@signature MonoidalCategoryAdditive{Ob,Hom} <: Category{Ob,Hom} begin
    oplus(A::Ob, B::Ob)::Ob
    oplus(f::(A → B), g::(C → D))::((A ⊕ C) → (B ⊕ D)) <=
    (A::Ob, B::Ob, C::Ob, D::Ob)
    @op (⊕) := oplus
    mzero()::Ob
end

@signature SymmetricMonoidalCategoryAdditive{Ob,Hom} <:
    MonoidalCategoryAdditive{Ob,Hom} begin
    swap(A::Ob, B::Ob)::Hom(oplus(A, B), oplus(B, A))
end

@syntax FreeSymmetricMonoidalCategoryAdditive{ObExpr,HomExpr} SymmetricMonoidalCategoryAdditive begin
    oplus(A::Ob, B::Ob) = associate_unit(new(A, B), mzero)
    oplus(f::Hom, g::Hom) = associate(new(f, g))
    compose(f::Hom, g::Hom) = associate(new(f, g; strict=true))
end

@theory MonoidalCategoryWithCodiagonals{Ob,Hom} <:
    SymmetricMonoidalCategoryAdditive{Ob,Hom} begin
    plus(A::Ob)::((A ⊕ A) → A)
    zero(A::Ob)::(mzero() → A)
  
  # Commutative monoid axioms.
    (plus(A) ⊕ id(A)) ⋅ plus(A) == (id(A) ⊕ plus(A)) ⋅ plus(A) ⊣ (A::Ob)
    (zero(A) ⊕ id(A)) ⋅ plus(A) == id(A) ⊣ (A::Ob)
    (id(A) ⊕ zero(A)) ⋅ plus(A) == id(A) ⊣ (A::Ob)
    plus(A) == swap(A, A) ⋅ plus(A) ⊣ (A::Ob)

  # Coherence axioms.
    plus(A ⊕ B) == (id(A) ⊕ swap(B, A) ⊕ id(B)) ⋅ (plus(A) ⊕ plus(B)) ⊣ (A::Ob, B::Ob)
    zero(A ⊕ B) == zero(A) ⊕ zero(B) ⊣ (A::Ob, B::Ob)
    plus(mzero()) == id(mzero())
    zero(mzero()) == id(mzero())
end

@theory CocartesianCategory{Ob,Hom} <: MonoidalCategoryWithCodiagonals{Ob,Hom} begin
    copair(f::(A → C), g::(B → C))::((A ⊕ B) → C) <= (A::Ob, B::Ob, C::Ob)
    coproj1(A::Ob, B::Ob)::(A → (A ⊕ B))
    coproj2(A::Ob, B::Ob)::(B → (A ⊕ B))

  # Definitions of copairing and coprojections.
    copair(f, g) == (f ⊕ g) ⋅ plus(C) ⊣ (A::Ob, B::Ob, C::Ob, f::(A → C), g::(B → C))
    coproj1(A, B) == id(A) ⊕ zero(B) ⊣ (A::Ob, B::Ob)
    coproj2(A, B) == zero(A) ⊕ id(B) ⊣ (A::Ob, B::Ob)
  
  # Naturality axioms.
    plus(A) ⋅ f == (f ⊕ f) ⋅ plus(B) ⊣ (A::Ob, B::Ob, f::(A → B))
    zero(A) ⋅ f == zero(B) ⊣ (A::Ob, B::Ob, f::(A → B))
end

@syntax FreeCocartesianCategory{ObExpr,HomExpr} CocartesianCategory begin
    oplus(A::Ob, B::Ob) = associate_unit(new(A, B), mzero)
    oplus(f::Hom, g::Hom) = associate(new(f, g))
    compose(f::Hom, g::Hom) = associate(new(f, g; strict=true))

    copair(f::Hom, g::Hom) = compose(oplus(f, g), plus(codom(f)))
    coproj1(A::Ob, B::Ob) = oplus(id(A), zero(B))
    coproj2(A::Ob, B::Ob) = oplus(zero(A), id(B))
end

@theory MonoidalCategoryWithBidiagonalsAdditive{Ob,Hom} <:
    MonoidalCategoryWithCodiagonals{Ob,Hom} begin
    mcopy(A::Ob)::(A → (A ⊕ A))
    @op (Δ) := mcopy
    delete(A::Ob)::(A → mzero())
    @op (◊) := delete
  
  # Commutative comonoid axioms.
    Δ(A) == Δ(A) ⋅ swap(A, A) ⊣ (A::Ob)
    Δ(A) ⋅ (Δ(A) ⊕ id(A)) == Δ(A) ⋅ (id(A) ⊕ Δ(A)) ⊣ (A::Ob)
    Δ(A) ⋅ (◊(A) ⊕ id(A)) == id(A) ⊣ (A::Ob)
    Δ(A) ⋅ (id(A) ⊕ ◊(A)) == id(A) ⊣ (A::Ob)
end

@theory SemiadditiveCategory{Ob,Hom} <:
    MonoidalCategoryWithBidiagonalsAdditive{Ob,Hom} begin
    pair(f::(A → B), g::(A → C))::(A → (B ⊕ C)) ⊣ (A::Ob, B::Ob, C::Ob)
    copair(f::(A → C), g::(B → C))::((A ⊕ B) → C) ⊣ (A::Ob, B::Ob, C::Ob)
    proj1(A::Ob, B::Ob)::((A ⊕ B) → A)
    proj2(A::Ob, B::Ob)::((A ⊕ B) → B)
    coproj1(A::Ob, B::Ob)::(A → (A ⊕ B))
    coproj2(A::Ob, B::Ob)::(B → (A ⊕ B))
  
    plus(f::(A → B), g::(A → B))::(A → B) ⊣ (A::Ob, B::Ob)
    @op (+) := plus
  
  # Naturality axioms.
    f ⋅ Δ(B) == Δ(A) ⋅ (f ⊕ f) ⊣ (A::Ob, B::Ob, f::(A → B))
    f ⋅ ◊(B) == ◊(A) ⊣ (A::Ob, B::Ob, f::(A → B))
    plus(A) ⋅ f == (f ⊕ f) ⋅ plus(B) ⊣ (A::Ob, B::Ob, f::(A → B))
    zero(A) ⋅ f == zero(B) ⊣ (A::Ob, B::Ob, f::(A → B))
  
  # Bimonoid axioms. (These follow from naturality + coherence axioms.)
    plus(A) ⋅ Δ(A) == (Δ(A) ⊕ Δ(A)) ⋅ (id(A) ⊕ swap(A, A) ⊕ id(A)) ⋅ (plus(A) ⊕ plus(A)) ⊣ (A::Ob)
    plus(A) ⋅ ◊(A) == ◊(A) ⊕ ◊(A) ⊣ (A::Ob)
    zero(A) ⋅ Δ(A) == zero(A) ⊕ zero(A) ⊣ (A::Ob)
    zero(A) ⋅ ◊(A) == id(mzero()) ⊣ (A::Ob)
end

@signature HypergraphCategoryAdditive{Ob,Hom} <:
    SymmetricMonoidalCategoryAdditive{Ob,Hom} begin
  # Supply of Frobenius monoids.
    mcopy(A::Ob)::(A → (A ⊕ A))
    @op (Δ) := mcopy
    delete(A::Ob)::(A → mzero())
    @op (◊) := delete
    mmerge(A::Ob)::((A ⊕ A) → A)
    @op (∇) := mmerge
    create(A::Ob)::(mzero() → A)
    @op (□) := create

  # Self-dual compact closed category.
    dunit(A::Ob)::(mzero() → (A ⊕ A))
    dcounit(A::Ob)::((A ⊕ A) → mzero())
    dagger(f::(A → B))::(B → A) ⊣ (A::Ob, B::Ob)
end

@signature RigCategory{Ob,Hom} <: SymmetricMonoidalCategoryAdditive{Ob,Hom} begin
    otimes(A::Ob, B::Ob)::Ob
    otimes(f::(A → B), g::(C → D))::((A ⊗ C) → (B ⊗ D)) ⊣
    (A::Ob, B::Ob, C::Ob, D::Ob)
    @op (⊗) := otimes
    munit()::Ob
end

@signature SymmetricRigCategory{Ob,Hom} <: RigCategory{Ob,Hom} begin
    braid(A::Ob, B::Ob)::((A ⊗ B) → (B ⊗ A))
    @op (σ) := braid
end

@theory DistributiveMonoidalCategory{Ob,Hom} <: SymmetricRigCategory{Ob,Hom} begin
    plus(A::Ob)::((A ⊕ A) → A)
    zero(A::Ob)::(mzero() → A)
  
    copair(f::(A → C), g::(B → C))::((A ⊕ B) → C) <= (A::Ob, B::Ob, C::Ob)
    coproj1(A::Ob, B::Ob)::(A → (A ⊕ B))
    coproj2(A::Ob, B::Ob)::(B → (A ⊕ B))
  
    copair(f, g) == (f ⊕ g) ⋅ plus(C) ⊣ (A::Ob, B::Ob, C::Ob, f::(A → C), g::(B → C))
    coproj1(A, B) == id(A) ⊕ zero(B) ⊣ (A::Ob, B::Ob)
    coproj2(A, B) == zero(A) ⊕ id(B) ⊣ (A::Ob, B::Ob)
  
  # Naturality axioms.
    plus(A) ⋅ f == (f ⊕ f) ⋅ plus(B) ⊣ (A::Ob, B::Ob, f::(A → B))
    zero(A) ⋅ f == zero(B) ⊣ (A::Ob, B::Ob, f::(A → B))
end

@theory DistributiveMonoidalCategoryWithDiagonals{Ob,Hom} <:
    DistributiveMonoidalCategory{Ob,Hom} begin
    mcopy(A::Ob)::(A → (A ⊗ A))
    @op (Δ) := mcopy
    delete(A::Ob)::(A → munit())
    @op (◊) := delete
end

@theory DistributiveSemiadditiveCategory{Ob,Hom} <: DistributiveMonoidalCategory{Ob,Hom} begin
    mcopy(A::Ob)::(A → (A ⊕ A))
    @op (Δ) := mcopy
    delete(A::Ob)::(A → mzero())
    @op (◊) := delete

    pair(f::(A → B), g::(A → C))::(A → (B ⊕ C)) ⊣ (A::Ob, B::Ob, C::Ob)
    proj1(A::Ob, B::Ob)::((A ⊕ B) → A)
    proj2(A::Ob, B::Ob)::((A ⊕ B) → B)
  
  # Naturality axioms.
    f ⋅ Δ(B) == Δ(A) ⋅ (f ⊕ f) ⊣ (A::Ob, B::Ob, f::(A → B))
    f ⋅ ◊(B) == ◊(A) ⊣ (A::Ob, B::Ob, f::(A → B))
end

@theory DistributiveCategory{Ob,Hom} <: DistributiveMonoidalCategoryWithDiagonals{Ob,Hom} begin
    pair(f::(A → B), g::(A → C))::(A → (B ⊗ C)) ⊣ (A::Ob, B::Ob, C::Ob)
    proj1(A::Ob, B::Ob)::((A ⊗ B) → A)
    proj2(A::Ob, B::Ob)::((A ⊗ B) → B)

    pair(f, g) == Δ(C) ⋅ (f ⊗ g) ⊣ (A::Ob, B::Ob, C::Ob, f::(C → A), g::(C → B))
    proj1(A, B) == id(A) ⊗ ◊(B) ⊣ (A::Ob, B::Ob)
    proj2(A, B) == ◊(A) ⊗ id(B) ⊣ (A::Ob, B::Ob)
  
  # Naturality axioms.
    f ⋅ Δ(B) == Δ(A) ⋅ (f ⊗ f) ⊣ (A::Ob, B::Ob, f::(A → B))
    f ⋅ ◊(B) == ◊(A) ⊣ (A::Ob, B::Ob, f::(A → B))
end
