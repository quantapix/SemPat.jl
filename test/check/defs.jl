lj_src_dir = joinpath(dirname(@__FILE__()), "..")
push!(LOAD_PATH, lj_src_dir)
using lj

usingTest() # using Base.Test / using Test

############################################
# Set to true to use the revised rules
############################################

test_revised_rules = false

############################################


# ----------------------------- Test Functions

# Global statistics
stats = RulesStats()

function lj_sub(x,y,tds=[])
  if !test_revised_rules
    sr = lj_subtype(x,y)
  else
    sr = lj_subtype_revised(x,y)
  end    
  addStats(stats, sr.stats)
  sr.sub
end

function lj_issub_strict(x::ANY,y::ANY)
  b1 = lj_sub(x,y)
  b2 = !lj_sub(y,x)
  return b1 && b2
end

function lj_isequal_type(x::ANY,y::ANY)
  b1 = lj_sub(x,y)
  b2 = lj_sub(y,x)
  return b1 && b2
end

lj_not_isequal_type(x::ANY,y::ANY) = !lj_isequal_type(x, y)

function j_issub_strict(x::ANY,y::ANY)
  b1 = issubtype(x,y)
  b2 = !issubtype(y,x)
  return b1 && b2
end

function j_isequal_type(x::ANY,y::ANY)
  b1 = issubtype(x,y)
  b2 = issubtype(y,x)
  return b1 && b2
end

j_not_isequal_type(x::ANY,y::ANY) = !j_isequal_type(x, y)

function issub(x::ANY,y::ANY)
  b1 = lj_sub(x,y) === issubtype(eval(Meta.parse(x)),eval(Meta.parse(y)))
  b2 = lj_sub(x,y) == true
  return b1 && b2
end
function issub(x::ANY,y::ANY,tds::Vector{String})
  b1 = lj_sub(x,y,tds) === issubtype(eval(Meta.parse(x)),eval(Meta.parse(y)))
  b2 = lj_sub(x,y,tds) == true
  return b1 && b2
end

function not_issub(x::ANY,y::ANY)
  b1 = lj_sub(x,y) === issubtype(eval(Meta.parse(x)),eval(Meta.parse(y)))
  b2 = lj_sub(x,y) == false
  return b1 && b2
end

issub_strict(x::ANY,y::ANY) =
    lj_issub_strict(x,y) === j_issub_strict(eval(Meta.parse(x)),eval(Meta.parse(y)))
isequal_type(x::ANY,y::ANY) =
    lj_isequal_type(x,y) === j_isequal_type(eval(Meta.parse(x)),eval(Meta.parse(y)))
not_isequal_type(x::ANY,y::ANY) =
    lj_not_isequal_type(x,y) === j_not_isequal_type(eval(Meta.parse(x)),eval(Meta.parse(y)))

# ----------------------------- Test Properties Aux

macro UnionAll(var, expr)
    Expr(:where, esc(expr), esc(var))
end

const Bottom = Union{}

## Takes testExpr and refExpr, tries to evaluate them and checks for equality.
## In case of exception, the macro returns [(true, _)] and performs @test_skip.
## Otherwise it returns [(false, ans)], where [ans] is [true] if
##   [testExpr] and [refExpr] evaluate to the same value ($testExpr == $refExpr),
##   and performs @test if [ans] is true and @test_skip otherwise.
## NOTE! Introduces variables [testEqRefVal] and [testException]
macro tryTestEq(testExpr, refExpr)
  quote
    local (gotException, testErrorMsg, testEqRefVal) = (false, "", true)
    try
        testVal = $(esc(testExpr))
        refVal  = $(esc(refExpr))
        testEqRefVal = testVal == refVal
        if testEqRefVal
          @test true
        else
          @test_skip false
        end
    catch err
        #println(err)
        gotException = true
        testErrorMsg = string(err)
        @test_skip false
    end
    (gotException, testErrorMsg, testEqRefVal)
  end
end

## Takes testExpr and tries to evaluate it.
## In case of exception, the macro returns [(true, _)] and performs @test_skip.
## Otherwise it returns [(false, ans)], where [ans] is a result of [testExpr],
##   and performs @test if [ans] is true and @test_skip otherwise.
## NOTE! Introduces variables [testVal] and [testException]
macro tryTest(testExpr)
  :(@tryTestEq $(esc(testExpr)) true)
end

## Performs @tryTestEq on testExpr and refExpr,
## and, if needed, pushes logExpr into either logExcepExpr (in case of exception)
## or logWrongExpr (in case of wrong result).
macro tryTestEqLog(testExpr, refExpr, logExpr, logExcepExpr, logWrongExpr)
  logExpr = esc(logExpr)
  quote
    local (gotException1, testErrorMsg1, valEqToSrc1) = 
        @tryTestEq $(esc(testExpr)) $(esc(refExpr))
    if gotException1
        push!($(esc(logExcepExpr)), ($logExpr, testErrorMsg1))
    elseif !valEqToSrc1
        push!($(esc(logWrongExpr)), $logExpr)
    end
  end
end

## Performs @tryTestEq on testExpr and refExpr,
## and, if needed, pushes logExpr into either logExcepExpr (in case of exception)
## or logWrongExpr (in case of wrong result).
macro tryTestLog(testExpr, logExpr, logExcepExpr, logWrongExpr)
  :(@tryTestEqLog $(esc(testExpr)) $(esc(true)) $(esc(logExpr)) $(esc(logExcepExpr)) $(esc(logWrongExpr)))
end

