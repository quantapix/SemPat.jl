using Qnarre.Lens
using Qnarre.Lens: Indeces, Field, Compo

struct Lens!{L}
    pure::L
end

(l::Lens!)(o) = l.pure(o)
function Lens.set(o, l::Lens!{<: Compo}, val)
    o_inner = l.pure.inner(o)
    set(o_inner, Lens!(l.pure.outer), val)
end
function Lens.set(o, l::Lens!{Field{prop}}, val) where {prop}
    setproperty!(o, prop, val)
    o
end
function Lens.set(o, l::Lens!{<:Indeces}, val) where {prop}
    o[l.pure.idxs...] = val
    o
end

using Test
mutable struct M
    a
    b
end

o = M(1, 2)
l = Lens!(@lens _.b)
set(o, l, 20)
@test o.b == 20

l = Lens!(@lens _.foo[1])
o = (foo = [1,2,3], bar = :bar)
set(o, l, 100)
@test o == (foo = [100,2,3], bar = :bar)

using Qnarre.Lens: make_set, make_lens, make_modify

macro myreset(ex)
    make_set(Lens!, ex)
end

macro mylens!(ex)
    make_lens(Lens!, ex)
end

macro mymodify!(f, ex)
    make_modify(Lens!, f, ex)
end

o = M(1, 2)
@myreset o.a = :hi
@myreset o.b += 98
@test o.a == :hi
@test o.b == 100

o = M(1, 3)
@mymodify!(x -> x + 1, o.a)
@test o.a === 2
@test o.b === 3

deep = [[[[1]]]]
@myreset deep[1][1][1][1] = 2
@test deep[1][1][1][1] === 2

l = @mylens! _.foo[1]
o = (foo = [1,2,3], bar = :bar)
set(o, l, 100)
@test o == (foo = [100,2,3], bar = :bar)
