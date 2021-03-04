abstract type Matcher end
abstract type Message end
abstract type State end

const Value = Vector{Any}
const EMPTY = Any[]

struct Ok{CS <: State,I} <: Message
    c_state::CS
    iter::I
    val::Value
end

struct Fail <: Message end
const FAIL = Fail()

struct Run{I} <: Message
    parent::Matcher
    p_state::State
    child::Matcher
    c_state::State
    iter::I
end

struct Clean <: State end
const CLEAN = Clean()

struct Dirty <: State end
const DIRTY = Dirty()

struct PException <: Exception; msg end
struct CacheException <: Exception end

abstract type FailException <: Exception end

const Applicable = Union{Function,DataType}

abstract type Config{S,I} end

mutable struct NoCache{S,I} <: Config{S,I}
    src::S
    stack::Vector{Tuple{Matcher,State}}
    NoCache{S,I}(s::S; kw...) where {S,I} = new{S,I}(s, Vector{Tuple{Matcher,State}}())
end

const Key{I} = Tuple{Matcher,State,I}

mutable struct Cache{S,I} <: Config{S,I}
    src::S
    stack::Vector{Tuple{Matcher,State,Key{I}}}
    cache::Dict{Key{I},Message}
    Cache{S,I}(s::S; kw...) where {I,S} = new{S,I}(s, Vector{Tuple{Matcher,State,Key{I}}}(), Dict{Key{I},Message}())
end
