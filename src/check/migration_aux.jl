lj_julia_dev() :: Bool = VERSION > VersionNumber(0,6,2)

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

is_notfound_marker(x) = x == (lj_julia_dev() ? nothing : 0)

function usingTest()
    usingCmd = "using " * (lj_julia_dev() ? "Test" : "Base.Test")
    eval(Main, Meta.parse(usingCmd))
end
