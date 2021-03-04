#               Julia Subtyping: A Rational Reconstruction
                ******************************************

The code in this directory contains the prototype implementation of
the Julia subtype checker described in the companion paper "Julia
subtyping reconstructed".

The code depends on Julia 0.6.2 (https://julialang.org).

The test suite can be validated using:

    $ julia tests/test_subtype_reference.jl

and

    $ julia tests/test_properties.jl

Alternatively the subtype algorithm can be invoked interactively by:

    $ julia --load lj.jl
    
or

    $ julia
    ...
    julia> include("lj.jl")
    --- LJ-INFO: LJ init
    ...
    Loading type declarations... Done

    julia> lj_subtype("Tuple{Int}", "Tuple{Union{String, T}} where T")
    = true
    = [T ^Any _Int64 R [false|1|0] false]  ||| 

The first line of the output gives the result of the subtype test, the
second line details the final variable environmnent.

A complete execution trace can be obtained by setting `f_debug` to `true`:

    julia> set_f_debug(true)

    julia> lj_subtype("Tuple{Int}", "Tuple{Union{String, T}} where T")
    
    <?xml version="1.0"?>
    <check>
    <rule id="ASTBase, TWhere">
    <t1>Tuple{Int64}</t1>
    <t2>Tuple{Union{String, T}} where T</t2>
    <env> ||| </env>
    <rule id="TTuple, TTuple">
    <t1>Tuple{Int64}</t1>
    ...
    = true
    = [T ^Any _Int64 R [false|1|0] false]  |||

The xml trace can be easily explored with an interactive xml-tree
visualiser.  We have used the online service at: xmlviewer.org

To run subtyping based on ahead-of-time normalization of types,
use the function `lj_subtype_revised` instead of `lj_subtype`:

    julia> lj_subtype_revised("Tuple{Int}", "Tuple{Union{String, T}} where T")
    = true
    = [T ^Any _Int64 R [false|1|0] false]  |||

It is also possible to invoke normalization + static diagonal marking:

    julia> lj_parse_and_normalize_type("Tuple{Union{String, T}} where T")
    Union{Tuple{String}, Tuple{T} where T}
    
    julia> lj_parse_and_normalize_type("Tuple{Union{String, T}, T} where T")
    Union{Tuple{String, T} where T, Tuple{T, T} where *T}

