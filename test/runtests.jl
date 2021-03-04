module TestModule
using Test

using Qnarre.Match
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

using Qnarre.Trait
@testset "Trait" begin
include("trait/base.jl")
include("trait/core.jl")
end

using Qnarre.Lens
import PerformanceTestTools
@testset "Lens" begin
include("lens/base.jl")
include("lens/core.jl")
include("lens/quick.jl")
#PerformanceTestTools.@include("lens/perf.jl")
end
=#

using Qnarre.Scan
#=
@testset "Scan" begin
include("scan/base.jl")
include("scan/core.jl")
end

using Qnarre.Parse
@testset "Parse" begin
include("parse/comb/base.jl")
include("parse/comb/core.jl")
include("parse/comb/calc.jl")
end

using Qnarre.FLParse
@testset "Lisp" begin
include("parse/fl/tests.jl")
end
=#

using Qnarre.JLParse
import Qnarre.JLParse: remlineinfo!, span, head, val, Parser, lisp_parse
@testset "Julia" begin
include("parse/jl/core.jl")
include("parse/jl/syntax.jl")
# JLParse.check_base()
end

#=
using Qnarre.Format
using Qnarre.Format: format, isformatted, Options
using FilePathsBase
@testset "Format" begin
include("format/tests.jl")
end
=#

#=
using Qnarre.Morph
include("morph/base.jl")
include("morph/syntax.jl")
include("morph/picture.jl")
=#

end
