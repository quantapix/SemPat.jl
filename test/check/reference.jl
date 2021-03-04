include("test_subtype_defs.jl")

## Subtype tests

################################################################################
### FROM JULIA TEST SUITE 0.6.2 with additions from 0.7.0-dev
################################################################################

# level 1: no varags, union, UnionAll
function test_1()
@testset "level 1: no varags, union, UnionAll" begin
    @test issub_strict("Int", "Integer")
    @test issub_strict("Array{Int,1}", "AbstractArray{Int,1}")

    @test isequal_type("Int", "Int")
    @test isequal_type("Integer", "Integer")
    @test isequal_type("Array{Int,1}", "Array{Int,1}")
    @test isequal_type("AbstractArray{Int,1}", "AbstractArray{Int,1}")

    @test issub_strict("Tuple{Int,Int}", "Tuple{Integer,Integer}")
    @test issub_strict("Tuple{Array{Int,1}}", "Tuple{AbstractArray{Int,1}}")

    @test isequal_type("Tuple{Integer,Integer}", "Tuple{Integer,Integer}")

    @test not_issub("Tuple{Int,Int}", "Tuple{Int}")
    @test not_issub("Tuple{Int}", "Tuple{Integer,Integer}")

    @test not_issub("Array{Int,1}", "Array{Integer,1}")
end
end

# level 2: varargs 
# we don't support varargs

# level diagonal: diagonal rule
function test_diagonal()
@testset "level diagonal: diagonal rule      " begin
     @test not_issub("Tuple{Integer,Integer}", "Tuple{T,T} where T")
     @test issub("Tuple{Integer,Int}", "Tuple{T,S} where S<:T where T")
     @test issub("Tuple{Integer,Int}", "Tuple{T,S} where T<:S<:T where T")
     @test not_issub("Tuple{Integer,Int,Int}", "Tuple{T,S,S} where T<:S<:T where T")

     @test issub_strict("Tuple{R,R} where R",
                        "Tuple{T,S} where S where T")
     @test issub_strict("Tuple{R,R} where R",
                        "Tuple{T,S} where S<:T where T")
     @test issub_strict("Tuple{R,R} where R",
                        "Tuple{T,S} where T<:S<:T where T")
     @test issub_strict("Tuple{R,R} where R",
                        "Tuple{T,S} where T<:S<:Any where T")

     @test not_issub("Tuple{Real,Real}", "Tuple{T,T} where T<:Real")

     @test issub("Tuple{S,R,Vector{Any}} where R<:AbstractString where S<:Int",
                 "Tuple{T, T, Array{T,1}} where T")

     @test issub_strict("Tuple{String, Real, Ref{Number}}",
                        "Tuple{Union{T,String}, T, Ref{T}} where T")

     @test issub_strict("Tuple{String, Real}",
                         "Tuple{Union{T,String}, T} where T")

     @test not_issub("Tuple{Real, Real}",
                     "Tuple{Union{T,String}, T} where T")

     @test issub_strict("Tuple{Int, Int}",
                        "Tuple{Union{T,String}, T} where T")
     
     # don't consider a diagonal variable concrete if it already has an abstract lower bound
     #@test isequal_type(Tuple{Vararg{A}} where A>:Integer,
     #                   Tuple{Vararg{A}} where A>:Integer)
     # JB: we don't support varargs, so here is a modification
     @test isequal_type("Tuple{A,A} where A>:Integer", "Tuple{B,B} where B>:Integer")
end
end

# level 3: UnionAll
function test_3()
@testset "level 3: UnionAll                  " begin

   @test issub_strict("Array{Int,1}", "Vector{T} where T")
   @test issub_strict(("Pair{T,T} where T"), "Pair")
   @test issub("Pair{Int,Int8}", "Pair")
   @test issub("Pair{Int,Int8}", "(Pair{Int,S} where S)")

   @test not_issub("(T where T<:Real)", "S where S<:Integer")

   @test isequal_type("Tuple{T,T} where T", "Tuple{R,R} where R")

   @test not_issub("(Tuple{T,S} where S<:Number where T<:Integer)",
                   "(Tuple{Q,R} where Q<:Number where R<:Integer)")

   @test issub_strict("(Tuple{Array{T},Array{T}} where T)",
                      "Tuple{Array, Array}")

     AUA = "Array{(Array{T,1} where T), 1}"
     UAA = "(Array{Array{T,1}, 1} where T)"

     @test not_issub(AUA, UAA)
     @test not_issub(UAA, AUA)
     @test not_isequal_type(AUA, UAA)

     @test issub_strict("Int where T", "Integer where T<:Integer")

     @test isequal_type("Tuple{T, Tuple{S}} where S where T",
                        "Tuple{Q, Tuple{R} where R} where Q")

     @test not_issub("Pair{T,T} where T", "Pair{Int,Int8}")
     @test not_issub("Pair{T,T} where T", "Pair{Int,Int}")

     @test isequal_type("Tuple{T} where T", "Tuple{Any}")
     @test isequal_type("Tuple{T} where T<:Real", "Tuple{Real}")

     @test  issub("Tuple{Array{Integer,1}, Int}",
                  "Tuple{Array{T,1},S} where S<:T where T<:Integer")

     @test not_issub("Tuple{Array{Integer,1}, Real}",
                     "Tuple{Array{T,1},T} where T<:Integer")

     @test not_issub("Tuple{Int,String,Vector{Integer}}",
                     "Tuple{T, T, Array{T,1}} where T")
     @test not_issub("Tuple{String,Int,Vector{Integer}}",
                     "Tuple{T, T, Array{T,1}} where T")
     @test not_issub("Tuple{Int,String,Vector{Tuple{Integer}}}",
                     "Tuple{T,T,Array{Tuple{T},1}} where T")

     @test issub("Tuple{Int,String,Vector{Any}}",
                 "Tuple{T, T, Array{T,1}} where T")

     @test isequal_type("Array{Int,1}", "Array{(T where T<:Int), 1}")
     @test isequal_type("Array{Tuple{Any},1}", "Array{(Tuple{T} where T), 1}")

     @test isequal_type("Array{Tuple{Int,Int},1}",
                        "Array{(Tuple{T,T} where T<:Int), 1}")
     @test not_issub("Array{Tuple{Int,Integer},1}",
                     "Array{(Tuple{T,T} where T<:Integer), 1}")

     @test not_issub("Pair{Int,Int8}", "Pair{T,T} where T")

     @test not_issub("Tuple{Array{Int,1}, Integer}",
                     "Tuple{Array{T,1},T} where T<:Integer")

     @test not_issub("Tuple{Integer, Array{Int,1}}",
                     "Tuple{T, Array{T,1}} where T<:Integer")

     @test not_issub("Pair{Array{Int,1},Integer}", "Pair{Array{T,1},T} where T")
     @test issub("Pair{Array{Int,1},Int}", "Pair{Array{T,1},T} where T")

     @test issub("Tuple{Integer,Int}", "Tuple{T,S} where S<:T where T<:Integer")
     @test not_issub("Tuple{Integer,Int}", "Tuple{T,S} where S<:T where T<:Int")
     @test not_issub("Tuple{Integer,Int}", "Tuple{T,S} where S<:T where T<:String")

     @test issub("Tuple{Float32,Array{Float32,1}}",
                 "Tuple{T,S} where S<:AbstractArray{T,1} where T<:Real")

     @test not_issub("Tuple{Float32,Array{Float64,1}}",
                    "Tuple{T,S} where S<:AbstractArray{T,1} where T<:Real")

     @test issub("Tuple{Float32,Array{Real,1}}",
                 "Tuple{T,S} where S<:AbstractArray{T,1} where T<:Real")

     @test not_issub("Tuple{Number,Array{Real,1}}",
                     "Tuple{T,S} where S<:AbstractArray{T,1} where T<:Real")

     @test issub("(T where Int<:T<:Integer)", "T where T<:Real")
     @test issub("(Array{T,1} where Int<:T<:Integer)",
                 "(Array{T,1} where T<:Real)")

     @test issub("T where Int<:T<:Integer", "S where Integer<:S<:Real")
     @test not_issub("Array{T,1} where Int<:T<:Integer",
                     "Array{T,1} where Integer<:T<:Real")

     X = ("Tuple{T,S} where S<:AbstractArray{T,1} where T<:Real")
     Y = ("Tuple{A,B} where B<:AbstractArray{A,1} where A<:Real")
     @test isequal_type(X,Y)
     Z = ("Tuple{Real,B} where B<:AbstractArray{A,1} where A<:Real")
     @test issub_strict(X,Z)

     @test issub_strict("Pair{Q,R} where R<:Q where Q", "Pair{T,S} where S where T")

     @test issub_strict(("Pair{T,S} where T<:S<:Any where T"),
                        ("Pair{T,S} where S where T"))

#     # these would be correct if the diagonal rule applied to type vars occurring
#     # only once in covariant position.
#     #@test issub_strict((@UnionAll T Tuple{Ref{T}, T}),
#     #                   (@UnionAll T @UnionAll S<:T Tuple{Ref{T},S}))
#     #@test issub_strict((@UnionAll T Tuple{Ref{T}, T}),
#     #                   (@UnionAll T @UnionAll S<:T @UnionAll R<:S Tuple{Ref{T},R}))

     @test isequal_type("Tuple{Ref{T}, T} where T",
                        "Tuple{Ref{T},S} where T<:S<:T where T")
     @test isequal_type("Tuple{Ref{T}, T} where T",
                        "Tuple{Ref{T},S} where S>:T where T")

     A = "Tuple{T,Ptr{T}} where T"
     B = "Tuple{Ptr{T},T} where T"
     
     C = "Tuple{Ptr{T},Ptr{S}} where Ptr<:S<:Any where Ptr<:T<:Any"
     D = "Tuple{Ptr{T},Ptr{S}} where Ptr{T}<:S<:Any where Ptr<:T<:Any"
     E = "Tuple{Ptr{S},Ptr{T}} where Ptr{T}<:S<:Any where Ptr<:T<:Any"

     @test not_issub(A, B)
     @test not_issub(B, A)
     @test issub_strict(C, A)
     @test issub_strict(C, B)
     @test issub_strict(C, D)
     @test issub_strict(string("Union{",D,",",E,"}"),A)
     @test issub_strict(string("Union{",D,",",E,"}"),B)
     @test issub_strict(
        "Tuple{Ptr{T},Ptr{S}} where T>:Ptr where Ptr<:S<:Ptr",
        "Tuple{Ptr{T},Ptr{S}} where S>:Ptr{T} where T>:Ptr")
     @test not_issub(
         "Tuple{Ptr{T},Ptr{S}} where S>:Ptr where T>:Ptr",
         "Tuple{Ptr{T},Ptr{S}} where Ptr{T}<:S<:Ptr where T>:Ptr")
     @test not_issub(
         "Tuple{Ptr{T},Ptr{S}} where S>:Ptr where T>:Integer", 
         B)
     @test  issub(
         "Tuple{Ptr{T},Ptr{S}} where S>:Integer where T>:Ptr", 
         B)
end
end

# level 4: Union
function test_4()
@testset "level 4: Union                     " begin
     @test isequal_type("Union{Union{},Union{}}", "Union{}")
     
     @test issub_strict("Int", "Union{Int,String}")
     @test issub_strict("Union{Int,Int8}", "Integer")
     
     @test isequal_type("Union{Int,Int8}", "Union{Int,Int8}")
     
     @test isequal_type("Union{Int,Integer}", "Integer")
     
     @test isequal_type("Tuple{Union{Int,Int8},Int16}",
                        "Union{Tuple{Int,Int16},Tuple{Int8,Int16}}")

#     @test issub_strict("Tuple{Int,Int8,Int}", "Tuple{Vararg{Union{Int,Int8}}}")
#     @test issub_strict("Tuple{Int,Int8,Int}", "Tuple{Vararg{Union{Int,Int8,Int16}}}")

     # nested unions
     @test not_issub("Union{Int,Ref{Union{Int,Int8}}}", "Union{Int,Ref{Union{Int8,Int16}}}")

     # A = Int64; B = Int8
     # C = Int16; D = Int32
     @test issub("Union{Union{Int64,Union{Int64,Union{Int8,Int16}}}, Union{Int32,Union{}}}",
                 "Union{Union{Int64,Int8},Union{Int16,Union{Int8,Int32}}}")

     @test not_issub("Union{Union{Int64,Union{Int64,Union{Int8,Int16}}}, Union{Int32,Union{}}}",
                     "Union{Union{Int64,Int8},Union{Int16,Union{Int8,Int64}}}")

     @test isequal_type("Union{Union{Int64,Int8,Int16}, Union{Int32}}",
                        "Union{Int64,Int8,Int16,Int32}")
     @test isequal_type("Union{Union{Int64,Int8,Int16}, Union{Int32}}",
                        "Union{Int64,Union{Int8,Int16},Int32}")
     @test isequal_type("Union{Union{Union{Union{Int64}},Int8,Int16}, Union{Int32}}",
                        "Union{Int64,Union{Int8,Int16},Int32}")

     @test issub_strict("Union{Union{Int64,Int16}, Union{Int32}}",
                        "Union{Int64,Int8,Int16,Int32}")

     @test not_issub("Union{Union{Int64,Int8,Int16}, Union{Int32}}",
                     "Union{Int64,Int16,Int32}")

#     # obviously these unions can be simplified, but when they aren't there's trouble
     X = "Union{Union{Int64,Int8,Int16},Union{Int64,Int8,Int16},Union{Int64,Int8,Int16},Union{Int64,Int8,Int16},
               Union{Int64,Int8,Int16},Union{Int64,Int8,Int16},Union{Int64,Int8,Int16},Union{Int64,Int8,Int16}}"
     Y = "Union{Union{Int32,Int8,Int16},Union{Int32,Int8,Int16},Union{Int32,Int8,Int16},Union{Int32,Int8,Int16},
               Union{Int32,Int8,Int16},Union{Int32,Int8,Int16},Union{Int32,Int8,Int16},Union{Int64,Int8,Int16}}"
     @test issub_strict(X,Y)
  end
end

# level 5: union and UnionAll
function test_5()
@testset "level 5: Union and UnionAll        " begin
#         u = Union{Int8,Int}

     @test issub("Tuple{String,Array{Int,1}}",
                 ("Union{Tuple{T,Array{T,1}}, Tuple{T,Array{Int,1}}} where T"))

     @test issub("Tuple{Union{Vector{Int},Vector{Int8}}}",
                 "Tuple{Array{T,1}} where T")

     @test not_issub("Tuple{Union{Vector{Int},Vector{Int8}},Vector{Int}}",
                     "Tuple{Array{T,1}, Array{T,1}} where T")
     
     @test not_issub(
        "Tuple{Union{Vector{Int},Vector{Int8}},Vector{Int8}}",
        "Tuple{Array{T,1}, Array{T,1}} where T")

     @test not_issub("Vector{Int}", "Array{T,1} where Union{Int8,Int} <: T <: Any")
     @test issub("Vector{Integer}", "Array{T,1} where Union{Int8,Int} <: T <: Any")
     @test issub("Vector{Union{Int,Int8}}", "Array{T,1} where Union{Int8,Int} <: T <: Any")

     @test issub("Array{T,1} where Int<:T<:Union{Int8,Int}", "Array{T,1} where Int<:T<:Union{Int8,Int}")

#     # with varargs
#     @test !issub(Array{Tuple{Array{Int},Array{Vector{Int16}},Array{Vector{Int}},Array{Int}}},
#                  @UnionAll T<:(@UnionAll S Tuple{Vararg{Union{Array{S}, Array{Array{S,1}}}}}) Array{T})

#     @test  issub(Array{Tuple{Array{Int},Array{Vector{Int}},Array{Vector{Int}},Array{Int}}},
#                  @UnionAll T<:(@UnionAll S Tuple{Vararg{Union{Array{S}, Array{Array{S,1}}}}}) Array{T})

#     @test !issub(Tuple{Array{Int},Array{Vector{Int16}},Array{Vector{Int}},Array{Int}},
#                  @UnionAll S Tuple{Vararg{Union{Array{S},Array{Array{S,1}}}}})

#     @test  issub(Tuple{Array{Int},Array{Vector{Int}},Array{Vector{Int}},Array{Int}},
#                  @UnionAll S Tuple{Vararg{Union{Array{S},Array{Array{S,1}}}}})

     B = "Tuple{S, Tuple{Any,Any,Any}, Ref{S}} where S<:Union{Int8,Int}"
#     # these tests require renaming in issub_unionall
     @test issub(string("Tuple{Int8, T, Ref{Int8}} where T<:",B), B)
     @test not_issub(string("Tuple{Int8, T, Ref{T}} where T<:",B ), B)

#     # the `convert(Type{T},T)` pattern, where T is a Union
#     # required changing priority of unions and vars
     @test issub("Tuple{Array{Union{Int8,Int},1},Int}", "Tuple{Array{T,1}, T} where T")
     @test issub("Tuple{Array{Union{Int8,Int},1},Int}", "Tuple{Array{T,1}, S} where S<:T where T")

     @test not_issub("Ref{Union{Ref{Int},Ref{Int8}}}", "Ref{Ref{T}} where T")
     @test issub("Tuple{Union{Ref{Int},Ref{Int8}}}", "Tuple{Ref{T}} where T")
     @test not_issub("Ref{Union{Ref{Int},Ref{Int8}}}", "Union{Ref{Ref{Int}}, Ref{Ref{Int8}}}")

     @test isequal_type("Ref{Tuple{Union{Int,Int8},Int16}}", "Ref{Union{Tuple{Int,Int16},Tuple{Int8,Int16}}}")
     @test isequal_type("Ref{T} where T<:Tuple{Union{Int,Int8},Int16}",
                        "Ref{Q} where Q<:Union{Tuple{Int,Int16},Tuple{Int8,Int16}}")

     @test isequal_type("Ref{Tuple{Union{Int,Int8},Int16,T}} where T",
                        "Ref{Union{Tuple{Int,Int16,S},Tuple{Int8,Int16,S}}} where S")
end
end

# tricky type variable lower bounds
function test_6()
@testset "level 6: tricky lower bounds       " begin


     @test  issub("Tuple{S,R,Vector{Any}} where R<:String where S<: Int",
                  "Tuple{T, T, Array{T,1}} where T")

     @test not_issub("Tuple{S,R,Vector{Integer}} where R<: String where S<:Int",
                     "Tuple{T, T, Array{T,1}} where T")

     t = "Tuple{T,T,Ref{T}} where T"
     @test isequal_type(t, "Tuple{S,S,Ref{S}} where S")

     @test not_issub("Tuple{T,String,Ref{T}} where T", "Tuple{Q,Q,Ref{Q}} where Q")
     @test not_issub("Tuple{T,Ref{T},String} where T", "Tuple{Q,Ref{Q},Q} where Q")

#     i = Int; ai = Integer
     @test isequal_type("Ref{T} where Int<:T<:Int", "Ref{Int}" )
     @test isequal_type("Ref{T} where Integer<:T<:Integer", "Ref{Integer}")

     # Pair{T,S} <: Pair{T,T} can be true with certain bounds
     @test issub_strict("Pair{T,S} where Int<:S<:Int where Int<:T<:Int",
                        "Pair{Q,Q} where Q")

     @test issub_strict("Tuple{Int, Ref{Int}}", "Tuple{S,Ref{T}} where S<: T where T")

     @test not_issub("Tuple{Real, Ref{Int}}", "Tuple{S,Ref{T}} where S<: T where T")

     # S >: T
     @test issub_strict("Tuple{Real, Ref{Int}}",
                       "Tuple{S,Ref{T}} where S>:T where T")
     @test not_issub("Tuple{Ref{Int}, Ref{Integer}}",
                     "Tuple{Ref{S},Ref{T}} where S>:T where T")

      @test issub_strict("Tuple{Ref{Real}, Ref{Integer}}",
                         "Tuple{Ref{S},Ref{T}} where S>:T where T")

      @test issub_strict("Tuple{Real, Ref{Tuple{Int}}}",
                         "Tuple{S,Ref{Tuple{T}}} where S>:T where T")

      @test not_issub("Tuple{Ref{Tuple{Int}}, Ref{Tuple{Integer}}}",
                      "Tuple{Ref{Tuple{S}},Ref{Tuple{T}}} where S>:T where T")

      @test issub_strict("Tuple{Ref{Tuple{Real}}, Ref{Tuple{Integer}}}",
                         "Tuple{Ref{Tuple{S}},Ref{Tuple{T}}} where S>:T where T")

#     # (@UnionAll x<:T<:x Q{T}) == Q{x}
      @test isequal_type("Ref{Ref{Int}}", "Ref{Ref{T} where Int<:T<:Int}")
      @test isequal_type("Ref{Ref{Int}}", "Ref{Ref{T}} where Int<:T<:Int")

      @test isequal_type("Ref{Ref{T}} where Int<:T<:Int", "Ref{Ref{S} where Int<:S<:Int}")

      @test not_issub("Ref{Ref{T}} where Int<:T<:Int", "Ref{Ref{S} where S<:Int}")


# FZN the two tests below are tricky, as they might cause vars to escape from their scope in constraints

    u = "Union{Int8,Int64}"
    A = "Ref{Union{}}"
    B = string("(Ref{S} where S<:",u,")")
    @test issub(string("Ref{",B,"}"), (string("Ref{T} where ",A,"<:T<:",B)))
#      @test_skip issub("Ref{Ref{S} where S<:Union{Int8,Int64}}", "Ref{T} where Ref{Union{}}<:T<:(Ref{S} where S<:Union{Int8,Int64})")

    C = string("(S where S<:",u,")")
    @test issub(string("Ref{",C,"}"), string("Ref{T} where ",u,"<:T<:",u))

#     @test_skip issub("Ref{S where S<:Union{Int8,Int64}}", "Ref{T} where Union{Int8,Int64}<:T<:Union{Int8,Int64}" )

#     BB = @UnionAll S<:Bottom S
#     @test issub(Ref{B}, @UnionAll BB<:U<:B Ref{U})
    # JB: normalization does not change the type, but pretty-printer misses brackets
    @test issub("Ref{Ref{S} where S<:Union{Int8,Int64}}","Ref{U} where (S where S<:Union{})<:U<:(Ref{S} where S<:Union{Int8,Int64})")
  
end
end

# # uncategorized
function test_7()
  @testset "level bonus: uncategorized         " begin
    @test isequal_type("Ref{Union{Int16, T}} where T", "Ref{Union{Int16, S}} where S")
    @test isequal_type("Pair{Union{Int16, T}, T} where T",
                       "Pair{Union{Int16, S}, S} where S")
  end
end

function test_Type()
  @testset "level Type: Type                   " begin
    @test issub_strict("DataType", "Type")
    @test issub_strict("Union", "Type")
    @test issub_strict("UnionAll", "Type")
    # FZN we used to not model the kinds Bottom and TypeVar
    @test issub_strict("Core.TypeofBottom"#= == typeof(Bottom) =#,
                       "Type")
    @test not_issub("TypeVar", "Type")
    @test not_issub("Type", "TypeVar")
    @test not_issub("DataType", "Type{T} where T<:Number")
    @test issub_strict("Type{Int}", "DataType")
    @test not_issub("Type{T} where T<:Integer", "DataType")
    @test isequal_type("Type{AbstractArray}", "Type{AbstractArray}")
    @test not_issub("Type{Int}", "Type{Integer}")
    @test issub("Type{T} where T<:Integer", "Type{T} where T<:Number")
    @test issub("Core.TypeofBottom", "Type{T} where T")

    # A: we don't model `isa`
#    @test isa(Int, @UnionAll T<:Number Type{T})
#    @test !isa(DataType, @UnionAll T<:Number Type{T})

    # JB: behaviour changed in 0.6.2; used to be issub
    @test not_issub("DataType", "Type{T} where T<:Type")

#     @test isa(Tuple{},Type{Tuple{}})
    @test not_issub("Tuple{Int,}", "Type{T} where T<:Tuple")
#    @test isa(Tuple{Int}, (@UnionAll T<:Tuple Type{T}))

    # this matches with T==DataType, since DataType is concrete
    @test issub("Tuple{Type{Int},Type{Int8}}", "Tuple{T,T} where T")
    @test not_issub("Tuple{Type{Int},Type{Union{}}}", "Tuple{T,T} where T")

    # issue #20476
    @test issub("Tuple{Type{Union{Type{UInt32}, Type{UInt64}}}, Type{UInt32}}",
                "Tuple{Type{T},T} where T")
    
    @test isequal_type("Core.TypeofBottom", "Type{Union{}}")
    @test issub("Core.TypeofBottom", "Type{T} where T<:Real")
  end
end

### Test from subtype.jl that are not inside functions

function test_misc()
  @testset "level misc: tests not in functions " begin
    # issue #21191
    let T1 = Val{Val{Val{Union{Int8,Int16,Int32,Int64,UInt8,UInt16}}}},
        T2 = Val{Val{Val{Union{Int8,Int16,Int32,Int64,UInt8, S}}}} where S
        @test issub(string(T1), string(T2))
    end
  end
end

################################################################################
### RUN TESTS
################################################################################

lj_test_delim = "------------------------------------------------------"

printheader(header :: String) = println("\n" * header * "\n" * lj_test_delim)

#----- Official suit 0.6.2 without properties
printheader("OFFICIAL SUIT 0.6.2 WITHOUT PROPERTIES")

test_1()
test_diagonal()
test_3()
test_4()
test_5()
test_6()
test_7()
test_Type()
test_misc()

println(STDOUT, stats)

