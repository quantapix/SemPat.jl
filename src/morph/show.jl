import Base.Meta: show_sexpr

function Base.show(io::IO, e::QExpr)
    print(io, head(e))
    print(io, "(")
    join(io, args(e), ",")
    print(io, ")")
end
function Base.show(io::IO, e::QExpr{:gen})
    v = first(e)
    if isnothing(v); show(io, v)
    else print(io, v)
    end
end

function Base.showerror(io::IO, e::SyntaxDomainError)
    print(io, "Error in term constructor $(e.constructor)(")
    join(io, e.args, ",")
    print(io, ")")
end


show_sexpr(e::QExpr) = show_sexpr(stdout, e)
function show_sexpr(io::IO, e::QExpr)
    if head(e) == :gen; print(io, repr(first(e)))
    else
        print(io, "(")
        join(io, [string(head(e)); [sprint(show_sexpr, x) for x in args(e)]], " ")
        print(io, ")")
    end
end

show_unicode(e::QExpr) = show_unicode(stdout, e)
function show_unicode(io::IO, e::QExpr; kw...)
    print(io, head(e))
    print(io, "{")
    join(io, [sprint(show_unicode, x) for x in args(e)], ",")
    print(io, "}")
end
show_unicode(io::IO, e::QExpr{:gen}; kw...) = print(io, first(e))
show_unicode(io::IO, x; kw...) = show(io, x)

function show_unicode_infix(io::IO, e::QExpr, op::String; paren::Bool=false)
    show_paren(io, e) = show_unicode(io, e; paren=true)
    if (paren) print(io, "(") end
    join(io, [sprint(show_paren, x) for x in args(e)], op)
    if (paren) print(io, ")") end
end

show_latex(e::QExpr) = show_latex(stdout, e)
show_latex(io::IO, s::Symbol; kw...) = print(io, s)
function show_latex(io::IO, e::QExpr; kw...)
    print(io, "\\mathop{\\mathrm{$(head(e))}}")
    print(io, "\\left[")
    join(io, [sprint(show_latex, x) for x in args(e)], ",")
    print(io, "\\right]")
end
function show_latex(io::IO, e::QExpr{:gen}; kw...)
    s = string(first(e))
    if all(isletter, s) && length(s) > 1; print(io, "\\mathrm{$s}")
    else print(io, s)
    end
end
show_latex(io::IO, x; kw...) = show(io, x)

function show_latex_infix(io::IO, e::QExpr, op::String; paren::Bool=false, kw...)
    show_paren(io, e) = show_latex(io, e, paren=true)
    sep = op == " " ? op : " $op "
    if (paren) print(io, "\\left(") end
    join(io, [sprint(show_paren, x) for x in args(e)], sep)
    if (paren) print(io, "\\right)") end
end

function show_latex_postfix(io::IO, e::QExpr, op::String; kw...)
    @assert length(args(e)) == 1
    print(io, "{")
    show_latex(io, first(e), paren=true)
    print(io, "}")
    print(io, op)
end

function show_latex_script(io::IO, e::QExpr, h::String; super::Bool=false, kw...)
    print(io, h, super ? "^" : "_", "{")
    join(io, [sprint(show_latex, x) for x in args(e)], ",")
    print(io, "}")
end
