@theory Category{Ob,Hom} begin
    @op begin
        (→) := Hom
        (⋅) := compose
    end

    Ob::TYPE

    Hom(dom::Ob, codom::Ob)::TYPE

    id(A::Ob)::(A → A)
    compose(f::(A → B), g::(B → C))::(A → C) ⊣ (A::Ob, B::Ob, C::Ob)

    ((f ⋅ g) ⋅ h == f ⋅ (g ⋅ h) ⊣ (A::Ob, B::Ob, C::Ob, D::Ob, f::(A → B), g::(B → C), h::(C → D)))
    f ⋅ id(B) == f ⊣ (A::Ob, B::Ob, f::(A → B))
    id(A) ⋅ f == f ⊣ (A::Ob, B::Ob, f::(A → B))
end

@syntax FreeCategory{ObExpr,HomExpr} Category begin
    compose(f::Hom, g::Hom) = associate(new(f, g; strict=true))
end

@signature Category2{Ob,Hom,Hom2} <: Category{Ob,Hom} begin
    Hom2(dom::Hom(A, B), codom::Hom(A, B))::TYPE ⊣ (A::Ob, B::Ob)
    @op (⇒) := Hom2

    id(f)::(f ⇒ f) ⊣ (A::Ob, B::Ob, f::(A ⇒ B))
    compose(α::(f ⇒ g), β::(g ⇒ h))::(f ⇒ h) ⊣ (A::Ob, B::Ob, f::(A → B), g::(A → B), h::(A → B))

    compose2(α::(f ⇒ g), β::(h ⇒ k))::((f ⋅ h) ⇒ (g ⋅ k)) ⊣ (A::Ob, B::Ob, C::Ob, f::(A → B), g::(A → B), h::(B → C), k::(B → C))
end

@syntax FreeCategory2{ObExpr,HomExpr,Hom2Expr} Category2 begin
    compose(f::Hom, g::Hom) = associate(new(f, g; strict=true))
    compose(α::Hom2, β::Hom2) = associate(new(α, β))
    compose2(α::Hom2, β::Hom2) = associate(new(α, β))
end

# Limits

@theory CategoryWithProducts{Ob,Hom,Terminal,Product} <: Category{Ob,Hom} begin
    Terminal()::TYPE
    Product(foot1::Ob, foot2::Ob)::TYPE
  
  # Terminal object.
    terminal()::Terminal()
    ob(⊤::Terminal())::Ob
    delete(⊤::Terminal(), C::Ob)::(C → ob(⊤))
  
  # Binary products.
    product(A::Ob, B::Ob)::Product(A, B)
    ob(Π::Product(A, B))::Ob ⊣ (A::Ob, B::Ob)
    proj1(Π::Product(A, B))::(ob(Π) → A) ⊣ (A::Ob, B::Ob)
    proj2(Π::Product(A, B))::(ob(Π) → B) ⊣ (A::Ob, B::Ob)
    (pair(Π::Product(A, B), f::(C → A), g::(C → B))::(C → ob(Π))
    ⊣ (A::Ob, B::Ob, C::Ob))
  
  # Projection axioms.
    (pair(Π, f, g) ⋅ proj1(Π) == f
    ⊣ (A::Ob, B::Ob, C::Ob, Π::Product(A, B), f::(C → A), g::(C → B)))
    (pair(Π, f, g) ⋅ proj2(Π) == g
    ⊣ (A::Ob, B::Ob, C::Ob, Π::Product(A, B), f::(C → A), g::(C → B)))
  
  # Uniqueness axioms.
    f == g ⊣ (C::Ob, ⊤::Terminal(), f::(C → ob(⊤)), g::(C → ob(⊤)))
    (pair(h ⋅ proj1(Π), h ⋅ proj2(Π)) == h
    ⊣ (A::Ob, B::Ob, C::Ob, Π::Product(A, B), h::(C → ob(Π))))
end

@theory CompleteCategory{Ob,Hom,Terminal,Product,Equalizer} <:
    CategoryWithProducts{Ob,Hom,Terminal,Product} begin
    Equalizer(f::(A → B), g::(A → B))::TYPE ⊣ (A::Ob, B::Ob)
  
  # Equalizers.
    equalizer(f::(A → B), g::(A → B))::Equalizer(f, g) ⊣ (A::Ob, B::Ob)
    ob(eq::Equalizer(f, g))::Ob ⊣ (A::Ob, B::Ob, f::(A → B), g::(A → B))
    (incl(eq::Equalizer(f, g))::(ob(eq) → A)
    ⊣ (A::Ob, B::Ob, f::(A → B), g::(A → B)))
    (factorize(eq::Equalizer(f, g), h::(C → A),
             eq_h::Equalizer(h ⋅ f, h ⋅ g))::(ob(eq_h) → ob(eq))
    ⊣ (A::Ob, B::Ob, C::Ob, f::(A → B), g::(A → B)))
  
  # Equalizer axioms.
    (incl(eq) ⋅ f == incl(eq) ⋅ g
    ⊣ (A::Ob, B::Ob, f::(A → B), g::(A → B), eq::Equalizer(f, g)))
    (incl(eq) == id(A)
    ⊣ (A::Ob, B::Ob, f::(A → B), eq::Equalizer(f, f)))
    (factorize(eq, h, eq_h) ⋅ incl(eq) == incl(eq_h) ⋅ h
    ⊣ (A::Ob, B::Ob, C::Ob, f::(A → B), g::(A → B), h::(C → A),
       eq::Equalizer(f, g), eq_h::Equalizer(h ⋅ f, h ⋅ g)))
    (factorize(eq, k ⋅ incl(eq), eq_k) == k
    ⊣ (A::Ob, B::Ob, D::Ob, f::(A → B), g::(A → B), eq::Equalizer(f, g),
       k::(D → ob(eq)), eq_k::Equalizer(k ⋅ incl(eq) ⋅ f, k ⋅ incl(eq) ⋅ g)))
end

# Colimits

@theory CategoryWithCoproducts{Ob,Hom,Initial,Coproduct} <: Category{Ob,Hom} begin
    Initial()::TYPE
    Coproduct(foot1::Ob, foot2::Ob)::TYPE

  # Initial object.
    initial()::Initial()
    ob(⊥::Initial())::Ob
    create(⊥::Initial(), C::Ob)::(ob(⊥) → C)
  
  # Binary coproducts.
    coproduct(A::Ob, B::Ob)::Coproduct(A, B)
    ob(⨆::Coproduct(A, B))::Ob ⊣ (A::Ob, B::Ob)
    coproj1(⨆::Coproduct(A, B))::(A → ob(⨆)) ⊣ (A::Ob, B::Ob)
    coproj2(⨆::Coproduct(A, B))::(B → ob(⨆)) ⊣ (A::Ob, B::Ob)
    (copair(⨆::Coproduct(A, B), f::(A → C), g::(B → C))::(ob(⨆) → C)
    ⊣ (A::Ob, B::Ob, C::Ob))
  
  # Coprojection axioms.
    (coproj1(⨆) ⋅ copair(⨆, f, g) == f
    ⊣ (A::Ob, B::Ob, C::Ob, ⨆::Coproduct(A, B), f::(A → C), g::(B → C)))
    (coproj2(⨆) ⋅ copair(⨆, f, g) == g
    ⊣ (A::Ob, B::Ob, C::Ob, ⨆::Coproduct(A, B), f::(A → C), g::(B → C)))
  
  # Uniqueness axioms.
    f == g ⊣ (C::Ob, ⊥::Initial(), f::(ob(⊥) → C), g::(ob(⊥) → C))
    (copair(coproj1(⨆) ⋅ h, coproj2(⨆) ⋅ h) == h
    ⊣ (A::Ob, B::Ob, C::Ob, ⨆::Coproduct(A, B), h::(ob(⨆) → C)))
end

@theory CocompleteCategory{Ob,Hom,Initial,Coproduct,Coequalizer} <:
    CategoryWithCoproducts{Ob,Hom,Initial,Coproduct} begin
    Coequalizer(f::(A → B), g::(A → B))::TYPE ⊣ (A::Ob, B::Ob)
  
  # Coequalizers.
    coequalizer(f::(A → B), g::(A → B))::Coequalizer(f, g) ⊣ (A::Ob, B::Ob)
    ob(eq::Coequalizer(f, g))::Ob ⊣ (A::Ob, B::Ob, f::(A → B), g::(A → B))
    (proj(eq::Coequalizer(f, g))::(B → ob(eq))
    ⊣ (A::Ob, B::Ob, f::(A → B), g::(A → B)))
    (factorize(coeq::Coequalizer(f, g), h::(B → C),
             coeq_h::Coequalizer(f ⋅ h, g ⋅ h))::(ob(coeq) → ob(coeq_h))
    ⊣ (A::Ob, B::Ob, C::Ob, f::(A → B), g::(A → B)))
  
  # Coequalizer axioms.
    (f ⋅ proj(coeq) == g ⋅ proj(coeq)
    ⊣ (A::Ob, B::Ob, f::(A → B), g::(A → B), coeq::Coequalizer(f, g)))
    (proj(coeq) == id(B)
    ⊣ (A::Ob, B::Ob, f::(A → B), coeq::Coequalizer(f, f)))
    (proj(coeq) ⋅ factorize(coeq, h, coeq_h) == h ⋅ proj(coeq_h)
    ⊣ (A::Ob, B::Ob, C::Ob, f::(A → B), g::(A → B), h::(B → C),
       coeq::Coequalizer(f, g), coeq_h::Coequalizer(f ⋅ h, g ⋅ h)))
    (factorize(coeq, proj(coeq) ⋅ k, coeq_k) == k
    ⊣ (A::Ob, B::Ob, D::Ob, f::(A → B), g::(A → B),
       coeq::Coequalizer(f, g), k::(ob(coeq) → D),
       coeq_k::Coequalizer(f ⋅ proj(coeq) ⋅ k, g ⋅ proj(coeq) ⋅ k)))
end

