==(a::Matcher, b::Matcher) = false
==(a::T, b::T) where {T <: Matcher} = true
==(a::State, b::State) = false
==(a::T, b::T) where {T <: State} = true

run(::Config, m, s, i) = error("$m did not expect to be called with state $s")
ok(::Config, m, s, t, i, r) = error("$m did not expect to receive state $s, result $r")
fail(::Config, m, s) = error("$m did not expect to receive state $s, failure")

run(::Config, ::Matcher, ::Dirty, i) = FAIL

abstract type Delegate <: Matcher end
abstract type DelegateState <: State end

run(::Config, m::Delegate, s::Clean, i) = Run(m, s, m.matcher, CLEAN, i)
run(::Config, m::Delegate, s::DelegateState, i) = Run(m, s, m.matcher, s.state, i)
fail(::Config, ::Delegate, s) = FAIL

@auto_hash_equals mutable struct Epsilon <: Matcher
    name::Symbol
    Epsilon() = new(:Epsilon)
end

run(::Config, ::Epsilon, ::Clean, i) = Ok(DIRTY, i, EMPTY)

@auto_hash_equals mutable struct Insert <: Matcher
    name::Symbol
    text
    Insert(x) = new(:Insert, x)
end

run(::Config, m::Insert, ::Clean, i) = Ok(DIRTY, i, Any[m.text])

@auto_hash_equals mutable struct Dot <: Matcher
    name::Symbol
    Dot() = new(:Dot)
end

function run(c::Config, ::Dot, ::Clean, i) 
    if iterate(c.src, i) === nothing; FAIL
    end
    c, i = iterate(c.src, i)
    Ok(DIRTY, i, Any[c])
end

@auto_hash_equals mutable struct Failed <: Matcher
    name::Symbol
    Failed() = new(:Failed)
end

run(::Config, ::Failed, ::Clean, i) = FAIL

@auto_hash_equals mutable struct Drop <: Delegate
    name::Symbol
    matcher::Matcher
    Drop(x) = new(:Drop, x)
end

@auto_hash_equals struct DropState <: DelegateState
    state::State
end

ok(::Config, ::Drop, s, t, i, ::Value) = Ok(DropState(t), i, EMPTY)

@auto_hash_equals mutable struct Case <: Delegate
    name::Symbol
    matcher::Matcher
    Case(x) = new(:Case, x)
end

@auto_hash_equals struct CaseState <: DelegateState
    state::State
end

function ok(::Config, ::Case, s, t, i, v::Value)
    new_s = CaseState(t)
    contents::AbstractString = v[1]
    new_contents = uppercase(contents[1:1]) * contents[2:end]
    Ok(new_s, i, Any[new_contents])
end

@auto_hash_equals mutable struct Equal <: Matcher
    name::Symbol
    string
    Equal(x) = new(:Equal, x)
end

function run(c::Config, m::Equal, ::Clean, i)
    for x in m.string
        if iterate(c.src, i) === nothing; return FAIL
        end
        y, i = iterate(c.src, i)
        if x != y; return FAIL
        end
    end
    Ok(DIRTY, i, Any[m.string])
end

abstract type Repeat_ <: Matcher end

ALL = typemax(Int)

abstract type RepeatState <: State end

function Repeat(m::Matcher, lo, hi; flatten=true, greedy=true, backtrack=true)
    if greedy; backtrack ? Depth(m, lo, hi; flatten) : Depth!(m, lo, hi; flatten)
    else backtrack ? Breadth(m, lo, hi; flatten) : Breadth!(m, lo, hi; flatten)
    end
end
Repeat(m::Matcher, lo; flatten=true, greedy=true, backtrack=true) = Repeat(m, lo, lo; flatten, greedy, backtrack)
Repeat(m::Matcher; flatten=true, greedy=true, backtrack=true) = Repeat(m, 0, ALL; flatten, greedy, backtrack)

repeat_ok(m::Repeat_, xs::Vector{Value}) = m.flatten ? flatten(xs) :  Any[xs...]

@auto_hash_equals mutable struct Depth <: Repeat_
    name::Symbol
    matcher::Matcher
    lo::Integer
    hi::Integer
    flatten::Bool
    Depth(m, lo, hi; flatten=true) = new(:Depth, m, lo, hi, flatten)
end

abstract type DepthState <: RepeatState end

arbitrary(s::DepthState) = s.iters[1]

@auto_hash_equals struct DepthSlurp{I} <: DepthState
    vs::Vector{Value} # accumulated.  starts []
    iters::Vector{I}       # at the end of the result.  starts [i].
    states::Vector{State}  # at the end of the result.  starts [DIRTY],
                           # since [] at i is returned last.
end

@auto_hash_equals struct DepthYield{I} <: DepthState
    vs::Vector{Value}
    iters::Vector{I}
    states::Vector{State}
end

@auto_hash_equals struct DepthBacktrack{I} <: DepthState
    vs::Vector{Value}
    iters::Vector{I}
    states::Vector{State}
end

max_depth(m::Depth, xs) = m.hi == length(xs)
run(c::Config{S,I}, m::Depth, ::Clean, i::I) where {S,I} = run(c, m, DepthSlurp{I}(Vector{Value}(), I[i], State[DIRTY]), i)
run(c::Config, m::Depth, s::DepthSlurp, i) = max_depth(m, s.vs) ? run(c, m, DepthYield(s.vs, s.iters, s.states), i) : Run(m, s, m.matcher, CLEAN, i)

function ok(c::Config, m::Depth, s::DepthSlurp, t, i, v::Value)
    vs = Value[s.vs..., v]
    iters = vcat(s.iters, i)
    states = vcat(s.states, t)
    if max_depth(m, vs); run(c, m, DepthYield(vs, iters, states), i)
    else Run(m, DepthSlurp(vs, iters, states), m.matcher, CLEAN, i)
    end
end

fail(c::Config, m::Depth, s::DepthSlurp) = run(c, m, DepthYield(s.vs, s.iters, s.states), arbitrary(s))

function run(c::Config, m::Depth, s::DepthYield, _)
    n = length(s.vs)
    if n >= m.lo; Ok(DepthBacktrack(s.vs, s.iters, s.states), s.iters[end], repeat_ok(m, s.vs))
    else run(c, m, DepthBacktrack(s.vs, s.iters, s.states), arbitrary(s))
    end
end

run(::Config, m::Depth, s::DepthBacktrack, _) = length(s.iters) == 1 ? FAIL : Run(m, DepthBacktrack(s.vs[1:end - 1], s.iters[1:end - 1], s.states[1:end - 1]), m.matcher, s.states[end], s.iters[end - 1])
ok(c::Config, m::Depth, s::DepthBacktrack, t, i, v::Value) = run(c, m, DepthSlurp(Value[s.vs..., v], vcat(s.iters, i), vcat(s.states, t)), i)
fail(c::Config, m::Depth, s::DepthBacktrack) = run(c, m, DepthYield(s.vs, s.iters, s.states), arbitrary(s))

@auto_hash_equals mutable struct Breadth <: Repeat_
    name::Symbol
    matcher::Matcher
    lo::Integer
    hi::Integer
    flatten::Bool
    Breadth(m, lo, hi; flatten=true) = new(:Breadth, m, lo, hi, flatten)
end

@auto_hash_equals struct Entry{I}
    iter::I
    state::State
    vs::Vector{Value}
end

abstract type BreadthState <: RepeatState end

arbitrary(s::BreadthState) = s.start

@auto_hash_equals struct BreadthGrow{I} <: BreadthState
    start::I
    queue::Vector{Entry{I}}
end

@auto_hash_equals struct BreadthYield{I} <: BreadthState
    start::I
    queue::Vector{Entry{I}}
end

run(c::Config{S,I}, m::Breadth, ::Clean, i::I) where {S,I} = run(c, m, BreadthYield{I}(i, Entry{I}[Entry{I}(i, CLEAN, Any[])]), i)

function run(c::Config, m::Breadth, s::BreadthYield, x)
    q = s.queue[1]
    n = length(q.vs)
    if n >= m.lo; Ok(BreadthGrow(s.start, s.queue), q.iter, repeat_ok(m, q.vs))
    else run(c, m, BreadthGrow(s.start, s.queue), x)
    end
end

run(::Config, m::Breadth, s::BreadthGrow, _) = length(s.queue[1].vs) > m.hi ? FAIL : Run(m, s, m.matcher, CLEAN, s.queue[1].iter)
ok(::Config, m::Breadth, s::BreadthGrow, t, i, v::Value) = Run(m, BreadthGrow(s.start, vcat(s.queue, Entry(i, t, Value[s.queue[1].vs..., v]))), m.matcher, t, i)
fail(c::Config, m::Breadth, s::BreadthGrow) = length(s.queue) > 1 ? run(c, m, BreadthYield(s.start, s.queue[2:end]), arbitrary(s)) : FAIL

@auto_hash_equals mutable struct Depth! <: Repeat_
    name::Symbol
    matcher::Matcher
    lo::Integer
    hi::Integer
    flatten::Bool
    Depth!(m, lo, hi; flatten=true) = new(:Depth!, m, lo, hi, flatten)
end

mutable struct DepthSlurp!{I} <: RepeatState
    vs::Vector{Value}
    iters::Vector{I}
end

hash(::DepthSlurp!, ::UInt) = throw(CacheException())
arbitrary(s::DepthSlurp!) = s.iters[1]

@auto_hash_equals struct DepthYield!{I} <: RepeatState
    vs::Vector{Value}
    iters::Vector{I}
end

run(c::Config{S,I}, m::Depth!, ::Clean, i::I) where {S,I} = run(c, m, DepthSlurp!{I}(Value[], I[i]), i)
run(c::Config, m::Depth!, s::DepthSlurp!, i) = length(s.vs) < m.hi ? Run(m, s, m.matcher, CLEAN, i) : run(c, m, DepthYield!(s.vs, s.iters), i)

function ok(c::Config, m::Depth!, s::DepthSlurp!, ::State, i, v::Value)
    push!(s.vs, v)
    push!(s.iters, i)
    run(c, m, s, i)
end

run(::Config, m::Depth!, s::DepthYield!, _) = length(s.vs) == m.lo ? Ok(DIRTY, s.iters[end], repeat_ok(m, s.vs)) : Ok(DepthYield!(s.vs[1:end - 1], s.iters[1:end - 1]), s.iters[end], repeat_ok(m, s.vs))
fail(c::Config, m::Depth!, s::DepthSlurp!) = run(c, m, DepthYield!(s.vs, s.iters), arbitrary(s))

@auto_hash_equals mutable struct Breadth! <: Repeat_
    name::Symbol
    matcher::Matcher
    lo::Integer
    hi::Integer
    flatten::Bool
    Breadth!(m, lo, hi; flatten=true) = new(:Breadth!, m, lo, hi, flatten)
end

@auto_hash_equals struct BreadthState!{I} <: RepeatState
    vs::Vector{Value}
    iter::I
end

run(c::Config, m::Breadth!, ::Clean, i) = m.lo == 0 ? Ok(BreadthState!(Value[], i), i, EMPTY) : run(c, m, BreadthState!(Value[], i), i)
run(::Config, m::Breadth!, s::BreadthState!, _) = length(s.vs) == m.hi ? FAIL : Run(m, s, m.matcher, CLEAN, s.iter)

function ok(c::Config, m::Breadth!, s::BreadthState!, ::State, i, v::Value)
    vs = Value[s.vs..., v]
    if length(vs) >= m.lo; Ok(BreadthState!(vs, i), i, repeat_ok(m, vs))
    else run(c, m, BreadthState!(vs, i), i)
    end
end

fail(::Config, ::Breadth!, ::BreadthState!) = FAIL

function Series(xs::Matcher...; flatten=true, backtrack=true)
    if flatten; backtrack ? Seq(xs...) : Seq!(xs...)
    else backtrack ? And(xs...) : And!(xs...)
    end
end

abstract type Series_ <: Matcher end

@auto_hash_equals mutable struct Seq <: Series_
    name::Symbol
    ms::Vector{Matcher}
    Seq(xs::Matcher...) = new(:Seq, [xs...])
    Seq(xs::Vector{Matcher}) = new(:Seq, xs)
end

serial_ok(::Seq, xs::Vector{Value}) = flatten(xs)

@auto_hash_equals mutable struct And <: Series_
    name::Symbol
    ms::Vector{Matcher}
    And(xs::Matcher...) = new(:And, Matcher[xs...])
    And(xs::Vector{Matcher}) = new(:And, xs)
end

serial_ok(::And, xs::Vector{Value}) = Any[xs...]

@auto_hash_equals struct SeriesState{I} <: State
    vs::Vector{Value}
    iters::Vector{I}
    states::Vector{State}
end

run(::Config, m::Series_, ::Clean, i) = length(m.ms) == 0 ? Ok(DIRTY, i, EMPTY) : Run(m, SeriesState(Value[], [i], State[]), m.ms[1], CLEAN, i)

function ok(::Config, m::Series_, s::SeriesState, t, i, v::Value)
    n = length(s.iters)
    vs = Value[s.vs..., v]
    iters = vcat(s.iters, i)
    states = vcat(s.states, t)
    if n == length(m.ms); Ok(SeriesState(vs, iters, states), i, serial_ok(m, vs))
    else Run(m, SeriesState(vs, iters, states), m.ms[n + 1], CLEAN, i)
    end
end

function fail(::Config, m::Series_, s::SeriesState)
    n = length(s.iters)
    if n == 1; FAIL
    else Run(m, SeriesState(s.vs[1:end - 1], s.iters[1:end - 1], s.states[1:end - 1]), m.ms[n - 1], s.states[end], s.iters[end - 1])
    end
end

function run(::Config, m::Series_, s::SeriesState, i)
    @assert length(s.states) == length(m.ms)
    Run(m, SeriesState(s.vs[1:end - 1], s.iters[1:end - 1], s.states[1:end - 1]), m.ms[end], s.states[end], s.iters[end - 1])
end

abstract type Series! <: Matcher end

@auto_hash_equals mutable struct Seq! <: Series!
    name::Symbol
    ms::Vector{Matcher}
    Seq!(xs::Matcher...) = new(:Seq!, Matcher[xs...])
    Seq!(xs::Vector{Matcher}) = new(:Seq!, xs)
end

serial_ok(::Seq!, xs::Vector{Value}) = flatten(xs)

@auto_hash_equals mutable struct And! <: Series!
    name::Symbol
    ms::Vector{Matcher}
    And!(xs::Matcher...) = new(:And!, Matcher[xs...])
    ANd!(xs::Vector{Matcher}) = new(:And!, xs)
end

serial_ok(::And!, xs::Vector{Value}) = Any[xs...]

@auto_hash_equals struct SeriesState! <: State
    vs::Vector{Value}
    i
end

run(c::Config, m::Series!, ::Clean, i) = run(c, m, SeriesState!(Value[], 0), i)
run(::Config, m::Series!, s::SeriesState!, i) = s.i == length(m.ms) ? Ok(DIRTY, i, serial_ok(m, s.vs)) : Run(m, SeriesState!(s.vs, s.i + 1), m.ms[s.i + 1], CLEAN, i)
ok(c::Config, m::Series!, s::SeriesState!, t, i, v::Value) = run(c, m, SeriesState!(Value[s.vs..., v], s.i), i)
fail(::Config, ::Series!, ::SeriesState!) = FAIL

Alternatives(xs::Matcher...; backtrack=true) = backtrack ? Alt(xs...) : Alt!(xs...)

abstract type Alternatives_ <: Matcher end

@auto_hash_equals mutable struct Alt <: Alternatives_
    name::Symbol
    ms::Vector{Matcher}
    Alt(xs::Matcher...) = new(:Alt, Matcher[xs...])
    Alt(xs::Vector{Matcher}) = new(:Alt, xs)    
end

@auto_hash_equals struct AltState{I} <: State
    state::State
    iter::I
    i::Int 
end

run(c::Config, m::Alt, ::Clean, i) = length(m.ms) == 0 ? FAIL : run(c, m, AltState(CLEAN, i, 1), i)
run(::Config, m::Alt, s::AltState, i) = Run(m, s, m.ms[s.i], s.state, s.iter)
ok(::Config, ::Alt, s::AltState, t, i, v::Value) = Ok(AltState(t, s.iter, s.i), i, v)
fail(c::Config, m::Alt, s::AltState) = s.i == length(m.ms) ? FAIL : run(c, m, AltState(CLEAN, s.iter, s.i + 1), s.iter)

@auto_hash_equals mutable struct Alt! <: Alternatives_
    name::Symbol
    ms::Vector{Matcher}
    Alt!(xs::Matcher...) = new(:Alt!, Matcher[xs...])
    Alt!(xs::Vector{Matcher}) = new(:Alt!, xs)    
end

@auto_hash_equals struct AltState!{I} <: State
    iter::I
    i::Int
end

run(c::Config, m::Alt!, ::Clean, i) = run(c, m, AltState!(i, 0), i)
function run(::Config, m::Alt!, s::AltState!, i)
    if s.i == length(m.ms); FAIL
    else Run(m, AltState!(i, s.i + 1), m.ms[s.i + 1], CLEAN, i)
    end
end
ok(::Config, ::Alt!, s::AltState!, t, i, v::Value) = Ok(s, i, v)
fail(c::Config, m::Alt!, s::AltState!) = run(c, m, AltState!(s.iter, s.i), s.iter)

@auto_hash_equals mutable struct Lookahead <: Delegate
    name::Symbol
    matcher::Matcher
    Lookahead(matcher) = new(:Lookahead, matcher)
end

@auto_hash_equals struct LookaheadState <: DelegateState
    state::State
    iter
end

run(::Config, m::Lookahead, s::Clean, i) = Run(m, LookaheadState(s, i), m.matcher, CLEAN, i)
ok(::Config, ::Lookahead, s, t, i, ::Value) = Ok(LookaheadState(t, s.iter), s.iter, EMPTY)

@auto_hash_equals mutable struct Not <: Matcher
    name::Symbol
    matcher::Matcher
    Not(matcher) = new(:Not, matcher)
end

@auto_hash_equals struct NotState <: State; iter end

run(::Config, m::Not, ::Clean, i) = Run(m, NotState(i), m.matcher, CLEAN, i)
run(::Config, ::Not, ::NotState, i) = FAIL
ok(::Config, ::Not, ::NotState, t, i, ::Value) = FAIL
fail(::Config, ::Not, s::NotState) = Ok(s, s.iter, EMPTY)

@auto_hash_equals mutable struct Pattern <: Matcher
    name::Symbol
    text::AbstractString
    regex::Regex
    groups::Tuple
    Pattern(r::Regex, group::Int...) = new(:Pattern, r.pattern, Regex("^(?:" * r.pattern * ")(.??)"), group)
    Pattern(s::AbstractString, group::Int...) = new(:Pattern, s, Regex("^(?:" * s * ")(.??)"), group)
    Pattern(s::AbstractString, flags::AbstractString, group::Int...) = new(:Pattern.s, Regex("^(?:" * s * ")(.??)", flags), group)
end

function run(c::Config, m::Pattern, ::Clean, i)
    x = match(m.regex, forwards(c.src, i))
    if x === nothing; FAIL
    else
        i = discard(c.src, i, x.offsets[end] - 1)
        if length(m.groups) > 0; Ok(DIRTY, i, Any[x.captures[i] for i in m.groups])
        else Ok(DIRTY, i, Any[x.match])
        end
    end
end

mutable struct Delayed <: Matcher
    name::Symbol
    matcher::Union{Matcher,Nothing}
    Delayed() = new(:Delayed, nothing)
end

run(::Config, ::Delayed, ::Dirty, i) = Response(DIRTY, i, FAIL)
run(c::Config, m::Delayed, s::State, i) = m.matcher === nothing ? error("set Delayed matcher") : run(c, m.matcher, s, i)

@auto_hash_equals mutable struct Eos <: Matcher
    name::Symbol
    Eos() = new(:Eos)
end

run(c::Config, ::Eos, ::Clean, i) = iterate(c.src, i) === nothing ? Ok(DIRTY, i, EMPTY) : FAIL

mutable struct PError{I} <: Exception
    msg::AbstractString
    iter::I
end

@auto_hash_equals mutable struct Error <: Matcher
    name::Symbol
    msg::AbstractString
    Error(msg::AbstractString) = new(:Error, msg)
end

function run(c::Config, m::Error, ::Clean, i::I) where {I}
    x = m.msg
    try
        x = diagnostic(c.src, i, m.msg)
    catch err
        println("cannot generate diagnostic for $(typeof(c.src))")
    end
    throw(PError{I}(x, i))
end

@auto_hash_equals mutable struct Transform <: Delegate
    name::Symbol
    matcher::Matcher
    f::Function
    Transform(matcher, f) = new(:Transform, matcher, f)
end

@auto_hash_equals struct TransformState <: DelegateState
    state::State
end

ok(::Config, m::Transform, s, t, i, v::Value) = Ok(TransformState(t), i, m.f(v))

@auto_hash_equals mutable struct ITransform <: Delegate
    name::Symbol
    matcher::Matcher
    f::Function
    ITransform(matcher, f) = new(:ITransform, matcher, f)
end

@auto_hash_equals struct ITransformState <: DelegateState
    state::State
end

ok(::Config, m::ITransform, s, t, i, v::Value) = Ok(ITransformState(t), i, m.f(i, v))

Appl(m::Matcher, f::Applicable) = Transform(m, x -> Any[f(x)])

function App(m::Matcher, f::Applicable)
    if f == vcat; Transform(m, x -> Any[x])
    else Transform(m, x -> Any[f(x...)])
    end
end

Opt(m::Matcher) = Alt(m, Epsilon())
Opt!(m::Matcher) = Alt!(m, Epsilon())

~(m::Matcher) = Drop(m)

!(m::Matcher) = Not(Lookahead(m))

+(a::Seq, b::Seq) = Seq(vcat(a.ms, b.ms))
+(a::Seq, b::Matcher) = Seq(vcat(a.ms, b))
+(a::Matcher, b::Seq) = Seq(vcat(a, b.ms))
+(a::Matcher, b::Matcher) = Seq(a, b)

(&)(a::And, b::And) = And(vcat(a.ms, b.ms))
(&)(a::And, b::Matcher) = And(vcat(a.ms, b))
(&)(a::Matcher, b::And) = And(vcat(a, b.ms))
(&)(a::Matcher, b::Matcher) = And(a, b)

|(a::Alt, b::Alt) = Alt(vcat(a.ms, b.ms))
|(a::Alt, b::Matcher) = Alt(vcat(a.ms, b))
|(a::Matcher, b::Alt) = Alt(vcat(a, b.ms))
|(a::Matcher, b::Matcher) = Alt(a, b)

>=(m::Matcher, f::Applicable) = TransResult(m, f)
>(m::Matcher, f::Applicable) = App(m, f)
|>(m::Matcher, f::Applicable) = Appl(m, f)

IAppl(m::Matcher, f::Applicable) = ITransform(m, (i, x) -> Any[f(i, x)])
IApp(m::Matcher, f::Applicable) = ITransform(m, (i, x) -> Any[f(i, x...)])

macro p_str(x)
    Pattern(Regex(x))
end

macro P_str(x)
    Drop(Pattern(Regex(x)))
end

macro e_str(x)
    Equal(x)
end

macro E_str(x)
    Drop(Equal(x))
end

parse_primitive(r::Regex, t::Type) = parse_primitive(Pattern(r), t)
# parse_primitive(r::Regex, t::Type; base=10) = parse_primitive(Pattern(r), t; base)
parse_primitive(m::Matcher, t::Type) = m > s -> parse(t, s)
# parse_primitive(m::Matcher, t::Type; base=10) = m > s -> parse(t, s; base)

PUInt() = parse_primitive(p"\d+", UInt)
PUInt8() = parse_primitive(p"\d+", UInt8)
PUInt16() = parse_primitive(p"\d+", UInt16)
PUInt32() = parse_primitive(p"\d+", UInt32)
PUInt64() = parse_primitive(p"\d+", UInt64)

PInt() = parse_primitive(p"-?\d+", Int)
PInt8() = parse_primitive(p"-?\d+", Int8)
PInt16() = parse_primitive(p"-?\d+", Int16)
PInt32() = parse_primitive(p"-?\d+", Int32)
PInt64() = parse_primitive(p"-?\d+", Int64)

PFloat32() = parse_primitive(p"-?(\d*\.?\d+|\d+\.\d*)([eE]\d+)?", Float32)
PFloat64() = parse_primitive(p"-?(\d*\.?\d+|\d+\.\d*)([eE]\d+)?", Float64)

Word() = p"\w+"
Space() = p"\s+"

Star(m::Matcher; flatten=true) = flatten ? m[0:end] : m[0:end,:&] 
Plus(m::Matcher; flatten=true) = flatten ? m[1:end] : m[1:end,:&] 
Star!(m::Matcher; flatten=true) = flatten ? m[0:end,:!] : m[0:end,:&,:!] 
Plus!(m::Matcher; flatten=true) = flatten ? m[1:end,:!] : m[1:end,:&,:!] 

StarList(m::Matcher, s::Matcher) = Alt(Seq(m, Star(Seq(s, m))), Epsilon())
StarList!(m::Matcher, s::Matcher) = Alt!(Seq!(m, Star!(Seq!(s, m))), Epsilon())
PlusList(m::Matcher, s::Matcher) = Seq(m, Star(Seq(s, m)))
PlusList!(m::Matcher, s::Matcher) = Seq!(m, Star!(Seq!(s, m)))
