import Base: collect, join, ndims, +, zero

compose(fs::Vector) = foldl(compose, fs)
compose(f, g, h, fs...) = compose([f, g, h, fs...])

show_unicode(io::IO, e::HomExpr{:compose}; kw...) = show_unicode_infix(io, e, "⋅"; kw...)
show_latex(io::IO, e::HomExpr{:id}; kw...) = show_latex_script(io, e, "\\mathrm{id}")
show_latex(io::IO, e::HomExpr{:compose}; paren::Bool=false, kw...) = show_latex_infix(io, e, "\\cdot"; paren=paren)

function show(io::IO, ::MIME"text/latex", e::QExpr)
    print(io, "\$")
    show_latex(io, e)
    print(io, "\$")
end

function show(io::IO, ::MIME"text/latex", e::HomExpr)
    print(io, "\$")
    show_latex(io, e)
    print(io, " : ")
    show_latex(io, dom(e))
    print(io, " \\to ")
    show_latex(io, codom(e))
    print(io, "\$")
end

compose2(αs::Vector) = foldl(compose2, αs)
compose2(α, β, γ, αs...) = compose2([α, β, γ, αs...])

show_unicode(io::IO, e::Hom2Expr{:compose}; kw...) = show_unicode_infix(io, e, "⋅"; kw...)
show_unicode(io::IO, e::Hom2Expr{:compose2}; kw...) = show_unicode_infix(io, e, "*"; kw...)

show_latex(io::IO, e::Hom2Expr{:compose}; kw...) = show_latex_infix(io, e, "\\cdot"; kw...)
show_latex(io::IO, e::Hom2Expr{:compose2}; kw...) = show_latex_infix(io, e, "*"; kw...)

otimes(xs::Vector{T}) where T = isempty(xs) ? munit(T) : foldl(otimes, xs)
otimes(x, y, z, xs...) = otimes([x, y, z, xs...])

collect(e::ObExpr) = [ e ]
collect(e::ObExpr{:munit}) = roottypeof(e)[]
collect(e::ObExpr{:otimes}) = vcat(map(collect, args(e))...)

roottype(T) = T isa UnionAll ? T : T.name.wrapper
roottypeof(x) = roottype(typeof(x))

ndims(::ObExpr) = 1
ndims(e::ObExpr{:munit}) = 0
ndims(e::ObExpr{:otimes}) = sum(map(ndims, args(e)))

show_unicode(io::IO, e::QExpr{:otimes}; kw...) = show_unicode_infix(io, e, "⊗"; kw...)
show_unicode(io::IO, ::ObExpr{:munit}; kw...) = print(io, "I")

show_latex(io::IO, e::QExpr{:otimes}; kw...) = show_latex_infix(io, e, "\\otimes"; kw...)
show_latex(io::IO, ::ObExpr{:munit}; kw...) = print(io, "I")

show_latex(io::IO, e::HomExpr{:braid}; kw...) = show_latex_script(io, e, "\\sigma")

show_latex(io::IO, e::HomExpr{:mcopy}; kw...) = show_latex_script(io, e, "\\Delta")
show_latex(io::IO, e::HomExpr{:delete}; kw...) = show_latex_script(io, e, "\\lozenge")

show_latex(io::IO, e::HomExpr{:mmerge}; kw...) = show_latex_script(io, e, "\\nabla")
show_latex(io::IO, e::HomExpr{:create}; kw...) = show_latex_script(io, e, "\\square")

function show_latex(io::IO, e::ObExpr{:hom}; kw...)
    print(io, "{")
    show_latex(io, last(e), paren=true)
    print(io, "}^{")
    show_latex(io, first(e))
    print(io, "}")
end
show_latex(io::IO, e::HomExpr{:ev}; kw...) = show_latex_script(io, e, "\\mathrm{eval}")
function show_latex(io::IO, e::HomExpr{:curry}; kw...)
    print(io, "\\lambda ")
    show_latex(io, last(e))
end

function distribute_mate(f::HomExpr)
    distribute_unary(distribute_unary(f, mate, compose, contravariant=true), mate, otimes, contravariant=true)
end

show_latex(io::IO, e::ObExpr{:dual}; kw...) = show_latex_postfix(io, e, "^*")
show_latex(io::IO, e::HomExpr{:dunit}; kw...) = show_latex_script(io, e, "\\eta")
show_latex(io::IO, e::HomExpr{:dcounit}; kw...) = show_latex_script(io, e, "\\varepsilon")
show_latex(io::IO, e::HomExpr{:mate}; kw...) = show_latex_postfix(io, e, "^*")

distribute_dagger(f::HomExpr) = distribute_unary(f, dagger, compose, unit=id, contravariant=true)

show_latex(io::IO, e::HomExpr{:dagger}; kw...) = show_latex_postfix(io, e, "^\\dagger")

function show_latex(io::IO, e::HomExpr{:trace}; kw...)
    X, A, B, f = args(e)
    print(io, "\\operatorname{Tr}_{$A,$B}^{$X} \\left($f\\right)")
end

oplus(xs::Vector{T}) where T = isempty(xs) ? mzero(T) : foldl(oplus, xs)
oplus(x, y, z, xs...) = oplus([x, y, z, xs...])

collect(e::ObExpr{:oplus}) = vcat(map(collect, args(e))...)
collect(e::ObExpr{:mzero}) = roottypeof(e)[]

ndims(e::ObExpr{:oplus}) = sum(map(ndims, args(e)))
ndims(e::ObExpr{:mzero}) = 0

show_unicode(io::IO, e::Union{ObExpr{:oplus},HomExpr{:oplus}}; kw...) = show_unicode_infix(io, e, "⊕"; kw...)
show_unicode(io::IO, ::ObExpr{:mzero}; kw...) = print(io, "O")

show_latex(io::IO, e::Union{ObExpr{:oplus},HomExpr{:oplus}}; kw...) = show_latex_infix(io, e, "\\oplus"; kw...)
show_latex(io::IO, ::ObExpr{:mzero}; kw...) = print(io, "O")

show_latex(io::IO, e::HomExpr{:swap}; kw...) = show_latex_script(io, e, "\\sigma")

show_latex(io::IO, e::HomExpr{:plus}; kw...) = length(args(e)) >= 2 ? show_latex_infix(io, e, "+"; kw...) : show_latex_script(io, e, "\\nabla")

show_latex(io::IO, e::HomExpr{:zero}; kw...) = show_latex_script(io, e, "0")

composeH(αs::Vector) = foldl(composeH, αs)
composeV(αs::Vector) = foldl(composeV, αs)
composeH(α, β, γ, αs...) = composeH([α, β, γ, αs...])
composeV(α, β, γ, αs...) = composeV([α, β, γ, αs...])

show_unicode(io::IO, e::Hom2Expr{:composeV}; kw...) = show_unicode_infix(io, e, "⋅"; kw...)
show_unicode(io::IO, e::Hom2Expr{:composeH}; kw...) = show_unicode_infix(io, e, "*"; kw...)

show_latex(io::IO, e::Hom2Expr{:composeV}; kw...) = show_latex_infix(io, e, "\\cdot"; kw...)
show_latex(io::IO, e::Hom2Expr{:composeH}; kw...) = show_latex_infix(io, e, "\\star"; kw...)

show_unicode(io::IO, e::HomVExpr{:braidV}; kw...) = show_unicode_infix(io, e, "σV"; kw...)
show_unicode(io::IO, e::Hom2Expr{:braidH}; kw...) = show_unicode_infix(io, e, "σH"; kw...)

show_latex(io::IO, e::HomVExpr{:braidV}; kw...) = show_latex_script(io, e, "\\sigmaV")
show_latex(io::IO, e::Hom2Expr{:braidH}; kw...) = show_latex_script(io, e, "\\sigmaH")
