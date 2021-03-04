@theory DoubleCategory{Ob,HomV,HomH,Hom2} begin
    Ob::TYPE

    HomV(dom::Ob, codom::Ob)::TYPE
    HomH(dom::Ob, codom::Ob)::TYPE

    Hom2(top::HomH(A, B),
       bottom::HomH(C, D),
       left::HomV(A, C),
       right::HomV(B, D))::TYPE ⊣ (A::Ob, B::Ob, C::Ob, D::Ob)
    @op begin
        (→) := HomH
        (↓) := HomV
        (⇒) := Hom2
        (⋆) := composeH
        (⋅) := composeV
    end

    idH(A::Ob)::(A → A) ⊣ (A::Ob)
    idV(A::Ob)::(A↓A) ⊣ (A::Ob)
    composeH(f::(A → B), g::(B → C))::(A → C) ⊣ (A::Ob, B::Ob, C::Ob)
    composeV(f::(A↓B), g::(B↓C))::(A↓C) ⊣ (A::Ob, B::Ob, C::Ob)

  # Category axioms for Horizontal morphisms
    ((f ⋆ g) ⋆ h == f ⋆ (g ⋆ h) ⊣ (A::Ob, B::Ob, C::Ob, D::Ob, f::(A → B), g::(B → C), h::(C → D)))
    f ⋆ idH(B) == f ⊣ (A::Ob, B::Ob, f::(A → B))
    idH(A) ⋆ f == f ⊣ (A::Ob, B::Ob, f::(A → B))

  # Category axioms for Vertical morphisms
    ((f ⋅ g) ⋅ h == f ⋅ (g ⋅ h) ⊣ (A::Ob, B::Ob, C::Ob, D::Ob, f::(A↓B), g::(B↓C), h::(C↓D)))
    f ⋅ idV(B) == f ⊣ (A::Ob, B::Ob, f::(A↓B))
    idV(A) ⋅ f == f ⊣ (A::Ob, B::Ob, f::(A↓B))

    id2(X::Ob)::Hom2(idH(X), idH(X), idV(X), idV(X)) ⊣ (X::Ob)
    id2V(f::(X → Y))::Hom2(f, f, idV(X), idV(Y)) ⊣ (X::Ob, Y::Ob)
    id2H(f::(X↓Y))::Hom2(idH(X), idH(Y), f, f) ⊣ (X::Ob, Y::Ob)

  # Vertical composition of 2-cells
    composeV(α::Hom2(t, b, l, r), β::Hom2(b, b′, l′, r′))::Hom2(t, b′, l ⋅ l′, r ⋅ r′) ⊣
    (A::Ob, B::Ob, X::Ob, Y::Ob, C::Ob, D::Ob,
     t::(A → B), b::(X → Y), l::(A↓X), r::(B↓Y),
     b′::(C → D), l′::(X↓C), r′::(Y↓D))

  # Horizontal composition of 2-cells
    composeH(α::Hom2(t, b, l, r), β::Hom2(t′, b′, r, r′))::Hom2(t ⋆ t′, b ⋆ b′, l, r′) ⊣
    (A::Ob, B::Ob, X::Ob, Y::Ob, C::Ob, D::Ob,
     t::(A → X), b::(B → Y), l::(A↓B), r::(X↓Y),
     t′::(X → C), b′::(Y → D), r′::(C↓D))
end

@syntax FreeDoubleCategory{ObExpr,HomVExpr,HomHExpr,Hom2Expr} DoubleCategory begin
    compose(f::HomV, g::HomV) = associate(new(f, g; strict=true))
    compose(f::HomH, g::HomH) = associate(new(f, g; strict=true))
    composeH(α::Hom2, β::Hom2) = associate(new(α, β))
    composeV(α::Hom2, β::Hom2) = associate(new(α, β))
end

@theory MonoidalDoubleCategory{Ob,HomV,HomH,Hom2} <: DoubleCategory{Ob,HomV,HomH,Hom2} begin
    otimes(A::Ob, B::Ob)::Ob
    otimes(f::(A → B), g::(C → D))::((A ⊗ C) → (B ⊗ D)) ⊣
    (A::Ob, B::Ob, C::Ob, D::Ob)
    otimes(f::(A↓B), g::(C↓D))::((A ⊗ C)↓(B ⊗ D)) ⊣
    (A::Ob, B::Ob, C::Ob, D::Ob)
    otimes(f::Hom2(t, b, l, r), g::Hom2(t′, b′, l′, r′))::Hom2(t ⊗ t′, b ⊗ b′, l ⊗ l′, r ⊗ r′) ⊣
    (A::Ob, B::Ob, C::Ob, D::Ob, E::Ob, F::Ob, G::Ob, H::Ob,
     t::(A → B), b::(C → D), l::(A↓C), r::(B↓D),
     t′::(E → F), b′::(G → H), l′::(E↓G), r′::(F↓H))

    @op (⊗) := otimes
    munit()::Ob

  # Monoid axioms, vertical.
    (A ⊗ B) ⊗ C == A ⊗ (B ⊗ C) ⊣ (A::Ob, B::Ob, C::Ob)
    A ⊗ munit() == A ⊣ (A::Ob)
    munit() ⊗ A == A ⊣ (A::Ob)
    (f ⊗ g) ⊗ h == f ⊗ (g ⊗ h) ⊣ (A::Ob, B::Ob, C::Ob, X::Ob, Y::Ob, Z::Ob,
                                f::(A↓X), g::(B↓Y), h::(C↓Z))

  # Monoid axioms, horizontal.
    (f ⊗ g) ⊗ h == f ⊗ (g ⊗ h) ⊣ (A::Ob, B::Ob, C::Ob, X::Ob, Y::Ob, Z::Ob,
                                f::(A → X), g::(B → Y), h::(C → Z))
    f ⊗ idH(munit()) == f ⊣ (A::Ob, B::Ob, f::(A → B))
    idH(munit()) ⊗ f == f ⊣ (A::Ob, B::Ob, f::(A → B))
    (α ⊗ β) ⊗ γ == α ⊗ (β ⊗ γ) ⊣
    (A::Ob, B::Ob, C::Ob, D::Ob, E::Ob, F::Ob,
     G::Ob, H::Ob, I::Ob, J::Ob, K::Ob, L::Ob,
     t1::(A → B), b1::(C → D), l1::(A↓C), r1::(B↓D),
     t2::(E → F), b2::(G → H), l2::(E↓G), r2::(F↓H),
     t3::(I → J), b3::(K → L), l3::(I↓K), r3::(J↓L),
     α::Hom2(t1, b1, l1, r1), β::Hom2(t2, b2, l2, r2), γ::Hom2(t3, b3, l3, r3))

  # Functorality axioms.
    ((f ⊗ g) ⋆ (h ⊗ k) == (f ⋆ h) ⊗ (g ⋆ k)
    ⊣ (A::Ob, B::Ob, C::Ob, X::Ob, Y::Ob, Z::Ob,
       f::(A → B), h::(B → C), g::(X → Y), k::(Y → Z)))
    ((f ⊗ g) ⋅ (h ⊗ k) == (f ⋅ h) ⊗ (g ⋅ k)
    ⊣ (A::Ob, B::Ob, C::Ob, X::Ob, Y::Ob, Z::Ob,
       f::(A↓B), h::(B↓C), g::(X↓Y), k::(Y↓Z)))
    ((α ⊗ β) ⋅ (γ ⊗ δ) == (α ⋅ γ) ⊗ (β ⋅ δ)
    ⊣ (A::Ob, B::Ob, C::Ob, D::Ob, E::Ob, F::Ob, G::Ob, H::Ob,
       I::Ob, J::Ob, K::Ob, L::Ob, M::Ob, N::Ob, O::Ob, P::Ob,
       t1::(A → B), b1::(C → D), l1::(A↓C), r1::(B↓D),
       t2::(E → F), b2::(G → H), l2::(E↓G), r2::(F↓H),
       t3::(I → J), b3::(K → L), l3::(I↓K), r3::(J↓L),
       t4::(M → N), b4::(O → P), l4::(M↓O), r4::(N↓P),
       α::Hom2(t1, b1, l1, r1), β::Hom2(t2, b2, l2, r2),
       γ::Hom2(t3, b3, l3, r3), δ::Hom2(t4, b4, l4, r4)))
    idH(A ⊗ B) == idH(A) ⊗ idH(B) ⊣ (A::Ob, B::Ob)
    idV(A ⊗ B) == idV(A) ⊗ idV(B) ⊣ (A::Ob, B::Ob)
    id2(A ⊗ B) == id2(A) ⊗ id2(B) ⊣ (A::Ob, B::Ob)
    id2H(f ⊗ g) == id2H(f) ⊗ id2H(g) ⊣ (A::Ob, B::Ob, C::Ob, D::Ob,
                                      f::(A↓C), g::(B↓D))
    id2V(f ⊗ g) == id2V(f) ⊗ id2V(g) ⊣ (A::Ob, B::Ob, C::Ob, D::Ob,
                                      f::(A → C), g::(B → D))
end

@theory SymmetricMonoidalDoubleCategory{Ob,HomV,HomH,Hom2} <: MonoidalDoubleCategory{Ob,HomV,HomH,Hom2} begin
    braidV(A::Ob, B::Ob)::((A ⊗ B)↓(B ⊗ A))
    braidH(f::(A → C), g::(B → D))::Hom2((f ⊗ g), (g ⊗ f), σV(A, B), σV(C, D)) ⊣
    (A::Ob, B::Ob, C::Ob, D::Ob)
    @op (σV) := braidV
    @op (σH) := braidH

  # Involutivity axioms.
    σV(A, B) ⋅ σV(B, A) == idV(A ⊗ B) ⊣ (A::Ob, B::Ob)
    σH(f, g) ⋅ σH(g, f) == id2V(f ⊗ g) ⊣ (A::Ob, B::Ob, C::Ob, D::Ob,
                                      f::(A → C), g::(B → D))

  # Naturality axioms.
    (f ⊗ g) ⋅ σV(C, D) == σV(A, B) ⋅ (g ⊗ f) ⊣ (A::Ob, B::Ob, C::Ob, D::Ob,
                                        f::(A↓C), g::(B↓D))
    ((α ⊗ β) ⋅ σH(h, k) == σH(f, g) ⋅ (β ⊗ α) ⊣
    (A::Ob, B::Ob, C::Ob, D::Ob, E::Ob, F::Ob, G::Ob, H::Ob,
     f::(A → C), g::(B → D), h::(E → G), k::(F → H),
     ℓ1::(A↓E), r1::(C↓G), ℓ2::(B↓F), r2::(D↓H),
     α::Hom2(f, h, ℓ1, r1), β::Hom2(g, k, ℓ2, r2)))

  # Coherence axioms.
    σV(A, B ⊗ C) == (σV(A, B) ⊗ idV(C)) ⋅ (idV(B) ⊗ σV(A, C)) ⊣ (A::Ob, B::Ob, C::Ob)
    σV(A ⊗ B, C) == (idV(A) ⊗ σV(B, C)) ⋅ (σV(A, C) ⊗ idV(B)) ⊣ (A::Ob, B::Ob, C::Ob)
    (σH(f, g ⊗ h) == (σH(f, g) ⊗ id2V(h)) ⋅ (id2V(g) ⊗ σH(f, h)) ⊣
    (A::Ob, B::Ob, C::Ob, D::Ob, E::Ob, F::Ob,
     f::(A → D), g::(B → E), h::(C → F)))
    (σH(f ⊗ g, h) == (id2V(f) ⊗ σH(g, h)) ⋅ (σH(f, h) ⊗ id2V(g)) ⊣
    (A::Ob, B::Ob, C::Ob, D::Ob, E::Ob, F::Ob,
     f::(A → D), g::(B → E), h::(C → F)))
end

@syntax FreeSymmetricMonoidalDoubleCategory{ObExpr,HomVExpr,HomHExpr,Hom2Expr} SymmetricMonoidalDoubleCategory begin
    otimes(A::Ob, B::Ob) = associate_unit(new(A, B), munit)
    otimes(f::HomV, g::HomV) = associate(new(f, g))
    otimes(f::HomH, g::HomH) = associate(new(f, g))
    otimes(f::Hom2, g::Hom2) = associate(new(f, g))
    compose(f::HomV, g::HomV) = associate(new(f, g; strict=true))
    compose(f::HomH, g::HomH) = associate(new(f, g; strict=true))
    composeH(α::Hom2, β::Hom2) = associate(new(α, β))
    composeV(α::Hom2, β::Hom2) = associate(new(α, β))
end

