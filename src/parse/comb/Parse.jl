module Parse

import Base: iterate, getindex, isless, size, hash, axes, lastindex, firstindex
import Base: ==, ~, +, &, |, >=, >, |>, !

using Printf: @printf

using ..Utils
using ..Match

include("utils.jl")
include("types.jl")
include("source.jl")
include("matchers.jl")
include("frame.jl")
include("parsers.jl")
include("debug.jl")
include("try.jl")

export @e_str, @E_str, @p_str, @P_str, @with_names, @with_post, @with_pre, 
ALL, Alt, Alt!, And, And!, App, Appl, axes, Breadth, Breadth!, Cache, Case,
Clean, CLEAN, Config, Debug, Delayed, Delegate, DelegateState, Depth, 
Depth!, diagnostic, DIRTY, Dirty, Dot, Drop, Empty, EMPTY, EMPTY, Eos,
Epsilon, Equal, Error, Fail, Failed, FAIL, forwards, IApp, IAppl, Insert,
ITransform, lastindex, LineIter, Lines, Lookahead, make_all, make_one, 
make, Matcher, NoCache, Not, Ok, once, Opt, Opt!, parse_all_cache_dbg, 
parse_all_cache, parse_all_dbg, parse_all_nocache_dbg, parse_all_nocache,
parse_all, parse_dbg, parse_lines_cache_dbg, parse_lines_cache, 
parse_lines_dbg, parse_lines, parse_one_cache_dbg, parse_one_cache, 
parse_one_dbg, parse_one_nocache_dbg, parse_one_nocache, parse_one,
parse_primitive, parse_try_cache_dbg, parse_try_cache, parse_try_dbg, 
parse_try, PError, PException, Pattern, PFloat32, PFloat64, PInt, 
PInt16, PInt32, PInt64, PInt8, Plus, Plus!, PlusList, PlusList!, PUInt, 
PUInt16, PUInt32, PUInt64, PUInt8, Repeat, Run, Seq, Seq!, Series, set_fix,
set_name, Space, Star, Star!, StarList, StarList!, State, Trace, Transform, 
Try, TrySource, Value, Word

end
