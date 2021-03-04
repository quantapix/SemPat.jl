@theory Schema{Ob,Hom,Data,Attr} <: Category{Ob,Hom} begin
    Data::TYPE
    Attr(dom::Ob, codom::Data)::TYPE
  
    compose(f::Hom(A, B), g::Attr(B, X))::Attr(A, X) ⊣ (A::Ob, B::Ob, X::Data)
    
    (compose(f, compose(g, a)) == compose(compose(f, g), a)
    ⊣ (A::Ob, B::Ob, C::Ob, X::Data, f::Hom(A, B), g::Hom(B, C), a::Attr(C, X)))
    compose(id(A), a) == a ⊣ (A::Ob, X::Ob, a::Attr(A, X))
end

abstract type SchemaExpr{T} <: QExpr{T} end
abstract type DataExpr{T} <: SchemaExpr{T} end
abstract type AttrExpr{T} <: SchemaExpr{T} end

@syntax FreeSchema{ObExpr,HomExpr,DataExpr,AttrExpr} Schema begin
  # should have a normal representation for precompose of a morphism + a gen attribute
end

struct CatDesc{Ob,Hom,Dom,Codom}
    CatDesc{Ob,Hom,Dom,Codom}() where {Ob,Hom,Dom,Codom} = new{Ob,Hom,Dom,Codom}()
    function CatDesc(pres::Picture{Schema})
        obs, homs = gens(pres, :Ob), gens(pres, :Hom)
        ob_syms, hom_syms = nameof.(obs), nameof.(homs)
        ob_num = ob -> findfirst(ob_syms .== ob)::Int
        new{Tuple(ob_syms),Tuple(hom_syms),Tuple(@. ob_num(nameof(dom(homs)))),Tuple(@. ob_num(nameof(codom(homs))))}()
    end
end

CatDescType(pres::Picture{Schema}) = typeof(CatDesc(pres))

function Base.getproperty(AD::Type{T}, i::Symbol) where
  {Ob,Hom,Dom,Codom,T <: CatDesc{Ob,Hom,Dom,Codom}}
    @match i begin
        :ob => Ob
        :hom => Hom
        :dom => Dom
        :codom => Codom
        _ => getfield(AD, i)
    end
end

ob_num(::Type{T}, ob::Symbol) where {Ob,Hom,Dom,Codom,T <: CatDesc{Ob,Hom,Dom,Codom}} = findfirst(Ob .== ob)::Int
hom_num(::Type{T}, hom::Symbol) where {Ob,Hom,Dom,Codom,T <: CatDesc{Ob,Hom,Dom,Codom}} = findfirst(Hom .== hom)::Int

dom_num(::Type{T}, hom::Int) where {Ob,Hom,Dom,Codom,T <: CatDesc{Ob,Hom,Dom,Codom}} = Dom[hom]
dom_num(CD::Type{<:CatDesc}, hom::Symbol) = dom_num(CD, hom_num(CD, hom))

codom_num(CD::Type{T}, hom::Int) where {Ob,Hom,Dom,Codom,T <: CatDesc{Ob,Hom,Dom,Codom}} = Codom[hom]
codom_num(CD::Type{<:CatDesc}, hom::Symbol) = codom_num(CD, hom_num(CD, hom))

dom(CD::Type{T}, hom::Union{Int,Symbol}) where {Ob,Hom,Dom,Codom,T <: CatDesc{Ob,Hom,Dom,Codom}} = Ob[dom_num(CD, hom)]
codom(CD::Type{T}, hom::Union{Int,Symbol}) where {Ob,Hom,Dom,Codom,T <: CatDesc{Ob,Hom,Dom,Codom}} = Ob[codom_num(CD, hom)]

struct AttrDesc{CD,Data,Attr,ADom,ACodom}
    AttrDesc{CD,Data,Attr,ADom,ACodom}() where {CD,Data,Attr,ADom,ACodom} = new{CD,Data,Attr,ADom,ACodom}()
    function AttrDesc(pres::Picture{Schema})
        CD = CatDescType(pres)
        datas, attrs = gens(pres, :Data), gens(pres, :Attr)
        data_syms, attr_syms = nameof.(datas), nameof.(attrs)
        ob_num = ob -> findfirst(CD.ob .== ob)::Int
        data_num = ob -> findfirst(data_syms .== ob)::Int
        new{CD,Tuple(data_syms),Tuple(attr_syms),Tuple(@. ob_num(nameof(dom(attrs)))),Tuple(@. data_num(nameof(codom(attrs))))}()
    end
    AttrDesc(::CatDesc{Ob,Hom,Dom,Codom}) where {Ob,Hom,Dom,Codom} = new{CatDesc{Ob,Hom,Dom,Codom},(),(),(),()}
end

AttrDescType(pres::Picture{Schema}) = typeof(AttrDesc(pres))

function Base.getproperty(AD::Type{T}, i::Symbol) where
  {CD,Data,Attr,ADom,ACodom,T <: AttrDesc{CD,Data,Attr,ADom,ACodom}}
    @match i begin
        :cd => CD
        :data => Data
        :attr => Attr
        :adom => ADom
        :acodom => ACodom
        _ => getfield(AD, i)
    end
end

data_num(::Type{T}, data::Symbol) where {CD,Data,Attr,ADom,ACodom,T <: AttrDesc{CD,Data,Attr,ADom,ACodom}} = findfirst(Data .== data)::Int
attr_num(::Type{T}, attr::Symbol) where {CD,Data,Attr,ADom,ACodom,T <: AttrDesc{CD,Data,Attr,ADom,ACodom}} = findfirst(Attr .== attr)::Int

dom_num(::Type{T}, attr::Int) where {CD,Data,Attr,ADom,ACodom,T <: AttrDesc{CD,Data,Attr,ADom,ACodom}} = ADom[attr]
dom_num(AD::Type{<:AttrDesc}, attr::Symbol) = dom_num(AD, attr_num(AD, attr))

codom_num(::Type{T}, attr::Int) where {CD,Data,Attr,ADom,ACodom,T <: AttrDesc{CD,Data,Attr,ADom,ACodom}} = ACodom[attr]
codom_num(AD::Type{<:AttrDesc}, attr::Symbol) = codom_num(AD, attr_num(AD, attr))

dom(AD::Type{T}, attr::Union{Int,Symbol}) where {CD,Data,Attr,ADom,ACodom,T <: AttrDesc{CD,Data,Attr,ADom,ACodom}} = CD.ob[dom_num(AD, attr)]
codom(AD::Type{T}, attr::Union{Int,Symbol}) where {CD,Data,Attr,ADom,ACodom,T <: AttrDesc{CD,Data,Attr,ADom,ACodom}} = Data[codom_num(AD, attr)]

SchemaType(pres::Picture{Schema}) = (CatDescType(pres), AttrDescType(pres))
