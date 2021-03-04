function dispatch(c::NoCache, r::Run)
    push!(c.stack, (r.parent, r.p_state))
    try
        run(c, r.child, r.c_state, r.iter)
    catch err
        isa(err, FailException) ? FAIL : rethrow()
    end
end
function dispatch(c::NoCache, o::Ok)
    (p, s) = pop!(c.stack)
    try
        return ok(c, p, s, o.c_state, o.iter, o.val)
    catch err
        isa(err, FailException) ? FAIL : rethrow()
    end
end
function dispatch(c::NoCache, ::Fail)
    (p, s) = pop!(c.stack)
    try
        return fail(c, p, s)
    catch err
        isa(err, FailException) ? FAIL : rethrow()
    end
end

function dispatch(c::Cache, r::Run)
    k = (r.child, r.c_state, r.iter)
    push!(c.stack, (r.parent, r.p_state, k))
    if haskey(c.cache, k); c.cache[k]
    else
        try
            run(c, r.child, r.c_state, r.iter)
        catch err
            isa(err, FailException) ? FAIL : rethrow()
        end
    end
end
function dispatch(c::Cache, o::Ok)
    p, s, k = pop!(c.stack)
    try
        c.cache[k] = o
    catch err
        isa(err, CacheException) ? nothing : rethrow()
    end
    try
        ok(c, p, s, o.c_state, o.iter, o.val)
    catch err
        isa(err, FailException) ? FAIL : rethrow()
    end
end
function dispatch(c::Cache, f::Fail)
    p, s, k = pop!(c.stack)
    try
        c.cache[k] = f
    catch err
        isa(err, CacheException) ? nothing : rethrow()
    end
    try
        fail(c, p, s)
    catch err
        isa(err, FailException) ? FAIL : rethrow()
    end
end

mutable struct Root <: Delegate
    name::Symbol
    Root() = new(:Root)
end

struct RootState <: DelegateState
    state::State
end

ok(::Config, ::Root, ::State, t::State, i, v::Value) = Ok(RootState(t), i, v)
fail(::Config, ::Root, ::State) = FAIL

function producer(ch::Channel, c::Config, m::Matcher; debug=false)
    root = Root()
    msg::Message = Run(root, CLEAN, m, CLEAN, firstindex(c.src))
    try
        while true
            msg = dispatch(c, msg)
            if isempty(c.stack)
                if isa(msg, Run); error("Unexpected run")
                elseif isa(msg, Ok)
                    put!(ch, msg.val)
                    msg = Run(root, CLEAN, m, msg.c_state.state, firstindex(c.src))
                else break
                end
            end
        end
    catch err
        if (debug)
            # println("debug was set, so showing error from inside task")
            # println(err)
            # Base.show_backtrace(stdout, catch_backtrace())
        end
        rethrow(err)
    end
end

function make(config, src::S, matcher; debug=false, kw...) where {S}
    I = typeof(firstindex(src))
    c = config{S,I}(src; debug, kw...)
    (c, Channel(x -> producer(x, c, matcher; debug)))
end

function make_all(config; kw...)
    function run(src, m::Matcher; kw2...)
        make(config, src, m; kw..., kw2...)[2]
    end
end

function once(channel)
    for x in channel
        return x
    end
    throw(PException("cannot parse"))
end

function make_one(config; kw...)
    function run(src, m::Matcher; kw2...)
        once(make(config, src, m; kw..., kw2...)[2])
    end
end

parse_all_cache = make_all(Cache)
parse_all_nocache = make_all(NoCache)
parse_all = parse_all_cache

parse_one_cache = make_one(Cache)
parse_one_nocache = make_one(NoCache)
parse_one = parse_one_nocache

parse_lines(s, m; kw...) = parse_one(Lines(s), m; kw...)
parse_lines_cache(s, m; kw...) = parse_one_cache(Lines(s), m; kw...)
