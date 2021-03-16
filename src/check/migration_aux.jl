## Returns true if it is julia 0.7.*
lj_julia_dev() :: Bool = VERSION > VersionNumber(0,6,2)

## In julia-0.7.0 we need to run [using Pkg] before using Pkg machinery,
## [using Printf] to use @printf,
## and define [issubtype], since it is deprecated
if lj_julia_dev()
    using Pkg
    using Printf
    using SparseArrays # for tests
    issubtype(t1::ANY, t2::ANY) = t1 <: t2
## Functions [equalto] and [findall] are not defined in julia 0.6
else
    #equalto(x) = (y -> y == x) #conflicts with some pkgs
    findall = find
    Nothing=Void
end

lj_equalto(x) = (y -> y == x)

## In julia-0.6 findfirst/findlast returns 0 if element wat not found,
## while in julia-0.7 they return nothing
is_notfound_marker(x) = x == (lj_julia_dev() ? nothing : 0)

## [using Base.Test] is deprecated in julia 0.7,
## [using Test] is to be written instead
function usingTest()
    usingCmd = "using " * (lj_julia_dev() ? "Test" : "Base.Test")
    eval(Main, Meta.parse(usingCmd))
end

## -------------------- julia 0.7 migration notes
## 
## 1) use [Meta.parse] instead of [parse]
## 2) use [using Test] instead of [using Base.Test]
## 3) use [findfirst/findlast(equalto(v), xs)] 
##    instead of [search/rsearch(xs, v)]
## 4) use [findall] instead of [find]
## 5) [findfirst/findlast] returns [nothing] instead of 0
##    (we use [is_notfound_marker] because of this)
## 6) [Void] became [Nothing]
## 7) [issubtype(t1, t2)] is deprecated, use [t1 <: t2]
