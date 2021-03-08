module TestModule
using Test

using SemPats.Match
include("utils/test.jl")

#=
@testset "Match" begin
include("match/base.jl")
include("match/mate.jl")
include("match/data.jl")
include("match/core.jl")
include("match/when.jl")
include("match/active.jl")
include("match/lambda.jl")
include("match/record.jl")
include("match/quick.jl")
end

using SemPats.Trait
@testset "Trait" begin
include("trait/base.jl")
include("trait/core.jl")
end

using SemPats.Lens
import PerformanceTestTools
@testset "Lens" begin
include("lens/base.jl")
include("lens/core.jl")
include("lens/quick.jl")
#PerformanceTestTools.@include("lens/perf.jl")
end
=#

using SemPats.Scan
#=
@testset "Scan" begin
include("scan/base.jl")
include("scan/core.jl")
end

using SemPats.Parse
@testset "Parse" begin
include("parse/comb/base.jl")
include("parse/comb/core.jl")
include("parse/comb/calc.jl")
end

using SemPats.FLParse
@testset "Lisp" begin
include("parse/fl/tests.jl")
end
=#

using SemPats.JLParse
import SemPats.JLParse: remlineinfo!, span, head, val, Parser, lisp_parse
@testset "Julia" begin
include("parse/jl/core.jl")
include("parse/jl/syntax.jl")
# JLParse.check_base()
end

#=
using SemPats.Format
using SemPats.Format: format, isformatted, Options
using FilePathsBase
@testset "Format" begin
include("format/tests.jl")
end
=#

#=
using SemPats.Morph
include("morph/base.jl")
include("morph/syntax.jl")
include("morph/picture.jl")
=#

end
