include("test_subtype_defs.jl")

### Test Subtyping Properties

const menagerie =
    Any[Bottom, Any, Int, Int8, Integer, Real,
        Array{Int,1}, AbstractArray{Int,1},
        #Tuple{Int,Vararg{Integer}}, Tuple{Integer,Vararg{Int}}, Tuple{},
        Union{Int,Int8},
        (@UnionAll T Array{T,1}),
        (@UnionAll T Pair{T,T}),
        (@UnionAll T @UnionAll S Pair{T,S}),
        Pair{Int,Int8},
        (@UnionAll S Pair{Int,S}),
        (@UnionAll T Tuple{T,T}),
        (@UnionAll T<:Integer Tuple{T,T}),
        (@UnionAll T @UnionAll S Tuple{T,S}),
        (@UnionAll T<:Integer @UnionAll S<:Number Tuple{T,S}),
        (@UnionAll T<:Integer @UnionAll S<:Number Tuple{S,T}),
        Array{(@UnionAll T Array{T,1}),1},
        (@UnionAll T Array{Array{T,1},1}),
        Array{(@UnionAll T<:Int T), 1},
        (@UnionAll T<:Real @UnionAll S<:AbstractArray{T,1} Tuple{T,S}),
        Union{Int,Ref{Union{Int,Int8}}},
        (@UnionAll T Union{Tuple{T,Array{T,1}}, Tuple{T,Array{Int,1}}}),
    ]

let new = Any[]
    # add variants of each type
    for T in menagerie
        push!(new, Ref{T})
        push!(new, Tuple{T})
        push!(new, Tuple{T,T})
        #push!(new, Tuple{Vararg{T}})
        push!(new, @UnionAll S<:T S)
        push!(new, @UnionAll S<:T Ref{S})
    end
    append!(menagerie, new)
end

#const menagerie_str = map(string, menagerie)
#println(length(menagerie_str)) #150
#println(join(menagerie_str, "\n"))

function test_properties()
@testset "level properties: props of subtype " begin
    x→y = !x || y
    ¬T = @UnionAll X>:T Ref{X}
    
    strTyPair = Tuple{String,String}     # (t1, t2)
    strTyExc  = Tuple{strTyPair, String} # ((t1,t2), errMsg)
    
    # Log info about failures
    bad_types_excep = strTyExc[]
    bad_types_wrong = strTyPair[]
    bad_props_excep = Dict{String, Vector{strTyExc}}()
    bad_props_wrong = Dict{String, Vector{strTyPair}}()
    testedPropNames = [
        "union-subsumption", "invariance", 
        "covariance", "pseudo-contravariance"
    ]
    for propName in testedPropNames
        bad_props_excep[propName] = strTyExc[]
        bad_props_wrong[propName] = strTyPair[]
    end
    
    tCnt = 0
    for T_src in menagerie
        T = string(T_src)
        tCnt += 1 # dumb "progress bar"
        println("###", tCnt, "###")

        # top and bottom identities
        @test issub("Union{}", T)
        @test issub(T, "Any")
        @test issub(T, "Union{}") → isequal_type(T, "Union{}")
        @test issub("Any", T) → isequal_type(T, "Any")

        # unionall identity
        @test isequal_type(T, string(@UnionAll S<:T_src S))

        skipped_types = [] 
        # skipped_types = [
        #   "Union{Tuple{T,Array{Int64,1}}, Tuple{T,Array{T,1}}} where T",
        #   "Ref{Union{Int64, Int8}}",
        #   "Ref{Union{Int64, Ref{Union{Int64, Int8}}}}",
        #   "Ref{Union{Tuple{T,Array{Int64,1}}, Tuple{T,Array{T,1}}} where T}",
        #   "Tuple{Union{Tuple{T,Array{Int64,1}}, Tuple{T,Array{T,1}}} where T}",
        #   "Tuple{Union{Tuple{T,Array{Int64,1}}, Tuple{T,Array{T,1}}} where T,Union{Tuple{T,Array{Int64,1}}, Tuple{T,Array{T,1}}} where T}",
        #   "Union{Tuple{T,Array{Int64,1}}, Tuple{T,Array{T,1}}} where T"
        # ]
        if in(T, skipped_types)
            @test_skip false
        else
            @test isequal_type("Ref{$(T)}", string(@UnionAll T_src<:U<:T_src Ref{U}))
        end

        # equality under renaming
        if isa(T_src, UnionAll)
            lb, ub = T_src.var.lb, T_src.var.ub
            @test isequal_type(T, string(@UnionAll lb<:Y<:ub T_src{Y}))
        end

        # inequality under wrapping
        skipped_types = [] 
        # skipped_types = [
        #   "Ref{S} where S<:Union{}",
        #   "Ref{S} where S<:Union{Int64, Int8}",
        #   "Ref{S} where S<:Union{Int64, Ref{Union{Int64, Int8}}}",
        #   "Ref{S} where S<:(Union{Tuple{T,Array{T,1}}, Tuple{T,Array{Int64,1}}} where T)",
        #   "Ref{S} where S<:(Union{Tuple{T,Array{Int64,1}}, Tuple{T,Array{T,1}}} where T)"
        # ]
        if in(T, skipped_types)
            @test_skip false
        else
            @test not_isequal_type(T, "Ref{$(T)}")
        end

        sCnt = 0
        for S_src in menagerie
            S = string(S_src)
            issubTS_src = T_src <: S_src # issubTS = issub(T, S)
            issubTS = issubTS_src # declare var
          
            sCnt += 1 # dumb "progress bar"
            print(sCnt, " ")
            
            # LJ subtype returns the same as Julia <: on T,S           
            @tryTestEqLog(issubTS = issub(T, S), issubTS_src, (T,S),
                bad_types_excep, bad_types_wrong)

#            continue # FZN
            # transitivity
            if issubTS_src # if issubTS
              for R_src in menagerie
                R = string(R_src)
                issubSR_src = S_src <: R_src
                
                # LJ subtype returns the same as Julia <: on S,R
                @tryTestEqLog(issub(S, R), issubSR_src, (S,R),
                    bad_types_excep, bad_types_wrong)
                
                if issubSR_src # if issub(S, R)
                  # @test issub(T, R) # issub(T,S) ∧ issub(S,R) → issub(T,R)
                  @tryTestLog(issub(T, R), (T,R),
                      bad_types_excep, bad_types_wrong)
                  # @test issub(Ref{S}, @UnionAll T<:U<:R Ref{U}) # S in T..R
                  RefS = "Ref{$(S)}"
                  RefU = string(@UnionAll T_src<:U<:R_src Ref{U})
                  @tryTestLog(issub(RefS, RefU), (RefS,RefU),
                      bad_types_excep, bad_types_wrong)
                end
              end
            end
            
            # JB: lj_subtype hangs or works too long when testing
            # FZN : TO BE INVESTIGATED
            # subtyping [Union{T,S} <: T] on normalized types
          
            if T != "Tuple{Union{Int64, Ref{Union{Int64, Int8}}},Union{Int64, Ref{Union{Int64, Int8}}}}"
            # union subsumption         
            #@test isequal_type(T, "Union{$(T),$(S)}") → issub(S, T)
            # JB: we use lj_sub instead of issub(S, T) here, 
            # because we intentionally changed the behaviour of Tuple{Union{}}
            @tryTestLog(lj_isequal_type(T, "Union{$(T),$(S)}") → lj_sub(S, T), 
                (T,S),
                bad_props_excep["union-subsumption"],
                bad_props_wrong["union-subsumption"])
            end

            # invariance
            #@test isequal_type(T, S) == isequal_type(Ref{T}, Ref{S})
            @tryTestLog(lj_isequal_type(T, S) == lj_isequal_type("Ref{$(T)}", "Ref{$(S)}"),
                (T,S),
                bad_props_excep["invariance"],
                bad_props_wrong["invariance"])

            # covariance
            #@test issubTS == issub(Tuple{T}, Tuple{S})
            @tryTestLog(issubTS == issub("Tuple{$(T)}", "Tuple{$(S)}"),
                (T,S),
                bad_props_excep["covariance"],
                bad_props_wrong["covariance"])
            #@test issubTS == issub(Tuple{Vararg{T}}, Tuple{Vararg{S}})
            #@test issubTS == issub(Tuple{T}, Tuple{Vararg{S}})

            # pseudo-contravariance
            #@test issubTS == issub(¬S, ¬T)
            @tryTestLog(issubTS == issub(string(¬S_src), string(¬T_src)),
                (T,S),
                bad_props_excep["pseudo-contravariance"],
                bad_props_wrong["pseudo-contravariance"])
        end
        println()
    end
    println()
    
    delim = "------------------------------------\n"
    printlnLogExcep(logData) = println(join(map(
        p -> p[1][1] * " <: " * p[1][2] * "\n    " * p[2], logData), "\n") * "\n")
    printlnLogWrong(logData) = println(join(map(
        p -> p[1] * " <: " * p[2], logData), "\n") * "\n")
    
    println("Results of testing properties:\n")
    maxLen = 10
    
    if length(bad_types_excep) > 0
      println("exceptions: $(length(bad_types_excep))\n" * delim)
      printlnLogExcep(bad_types_excep[1:min(length(bad_types_excep), maxLen)])
    end
    if length(bad_types_wrong) > 0
      println("wrong result: $(length(bad_types_wrong))\n" * delim)
      printlnLogWrong(bad_types_wrong[1:min(length(bad_types_wrong), maxLen)])
    end

    printlnLogExcepProp(logData) = println(join(map(
        p -> "T == " * p[1][1] * "\n" * "S == " * p[1][2] * "\n    " * 
             p[2] * "\n", logData), "\n") * "\n")
    printlnLogWrongProp(logData) = println(join(map(
        p -> "T == " * p[1] * "\n" * "S == " * p[2] * "\n", logData), "\n") * "\n")
    
    for (propName, propFormula) in [("union-subsumption", "(T == Union{T, S}) → (S <: T)"), 
        ("invariance", "(T == S) == (Ref{T} == Ref{S})"), 
        ("covariance", "(T <: S) == (Tuple{T} <: Tuple{S})"), 
        ("pseudo-contravariance", "(T <: S) == (¬S <: ¬T)")
    ]
        len11 = length(bad_props_excep[propName])
        len12 = length(bad_props_wrong[propName])
        if len11 > 0
          println("exceptions prop[$(propName)]: $(len11)\n" *
                  "formula: " * propFormula * "\n" * delim)
          printlnLogExcepProp(bad_props_excep[propName][1:min(len11, maxLen)])
        end
        if len12 > 0
          println("wrong result prop[$(propName)]: $(len12)\n" *
                  "formula: " * propFormula * "\n" * delim)
          printlnLogWrongProp(bad_props_wrong[propName][1:min(len12, maxLen)])
        end
    end
end
end

################################################################################
### RUN TESTS
################################################################################

lj_test_delim = "------------------------------------------------------"

printheader(header :: String) = println("\n" * header * "\n" * lj_test_delim)

println("\nTEST PROPERTIES\n")
test_properties()
println(STDOUT, stats)

