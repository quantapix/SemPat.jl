is_equal(x) = x.head == :(=) && length(x.args) == 2
is_symbol_1(x) = isa(x.args[1], Symbol)
is_delayed_1(x) = isa(x.args[1], Expr) && x.args[1].head == :. && length(x.args[1].args) == 2 && isa(x.args[1].args[1], Symbol) && x.args[1].args[2] == :matcher

set_fix(::Bool, ::Matcher, x) = x
set_fix(::Bool, ::Matcher, x::Delayed) = x
set_fix(pre::Bool, p::Matcher, m::Matcher) = pre ? Seq(p, m) : Seq(m, p)

set_fixes(pre, p, x) = x
function set_fixes(pre::Bool, p, e::Expr)
    if is_equal(e) && (is_symbol_1(e) || is_delayed_1(e)); e.args[2] = Expr(:call, :set_fix, pre, p, e.args[2])
    end
    e.args = map(x -> set_fixes(pre, p, x), e.args)
    e
end

set_name(x, ::Symbol) = x
set_name(m::Matcher, s::Symbol) = (m.name = s; m)    

set_names(x) = x
function set_names(e::Expr)
    if e.head == :(=) && length(e.args) == 2 && isa(e.args[1], Symbol)
        e.args[2] = Expr(:call, :set_name, e.args[2], QuoteNode(e.args[1]))
    end
    e.args = map(set_names, e.args)
    e
end

parent(c::Config) = c.stack[end][1]
size(m::Matcher, n) = endof(m)
axes(m::Matcher, n) = (n == 1) ? Base.OneTo(lastindex(m)) : 1
lastindex(::Matcher) = typemax(Int)
lastindex(m::Matcher, n) = last(axes(m, n))

getindex(m::Matcher, r::Int, s::Symbol...) = getindex(m, r:r; s...)
function getindex(m::Matcher, r::UnitRange, s::Symbol...)
    greedy = true
    flatten = true
    backtrack = true
    for x in s
        if x == :?; greedy = false
        elseif x == :&; flatten = false
        elseif x == :!; backtrack = false
        else error("bad flag to []: $x")
        end
    end
    Repeat(m, r.start, r.stop; greedy, flatten, backtrack)
end

macro with_names(x)
    esc(set_names(x))
end

macro with_pre(pre, block)
    esc(set_fixes(true, pre, block))
end

macro with_post(post, block)
    esc(set_fixes(false, post, block))
end

always_print(::Matcher) = false
always_print(::Delegate) = true
always_print(::Equal) = true
always_print(::Transform) = false
always_print(::ITransform) = false

print_field(::Matcher, ::Type{Val{N}}) where {N} = "$(N)"
print_field(m::Repeat_, ::Type{Val{:lo}}) = "lo=$(m.lo)"
print_field(m::Repeat_, ::Type{Val{:hi}}) = "hi=$(m.hi)"
print_field(m::Repeat_, ::Type{Val{:flatten}}) = "flatten=$(m.flatten)"
print_field(m::Pattern, ::Type{Val{:text}}) = "text=\"$(m.text)\""
print_field(m::Pattern, ::Type{Val{:regex}}) = "regex=r\"$(m.regex.pattern)\""
print_field(m::Equal, ::Type{Val{:string}}) = isa(m.string, AbstractString) ? "\"$(m.string)\"" : :string

print_matcher(m::Matcher) = print_matcher(m, Set{Matcher}())
function print_matcher(m::Matcher, known::Set{Matcher})
    function producer(c::Channel)
        if m in known; put!(c, "$(m.name)...")
        else
            put!(c, "$(m.name)")
            if !always_print(m); push!(known, m)
            end
            ns = [x for x in fieldnames(typeof(m)) if x != :name]
            for n in ns
                if isa(getfield(m, n), Matcher)
                    for (i, line) = enumerate(print_matcher(getfield(m, n), known))
                        if n == ns[end]; put!(c, i == 1 ? "`-$(line)" : "  $(line)")
                        else put!(c, i == 1 ? "+-$(line)" : "| $(line)")
                        end
                    end
                elseif isa(getfield(m, n), Array{Matcher,1})
                    for (j, x) in enumerate(getfield(m, n))
                        tag = n == :matchers ? "[$j]" : "$(n)[$j]"
                        for (i, line) = enumerate(print_matcher(getfield(m, n)[j], known))
                            if n == ns[end] && j == length(getfield(m, n)); put!(c, i == 1 ? "`-$(tag):$(line)" : "  $(line)")
                            else put!(c, i == 1 ? "+-$(tag):$(line)" : "| $(line)")
                            end
                        end
                    end
                else
                    if n == ns[end]; put!(c, "`-$(print_field(m, Val{n}))")
                    else put!(c, "+-$(print_field(m, Val{n}))")
                    end
                end
            end
        end
    end
    Channel(c -> producer(c))
end
function print_matcher(m::Delayed, known::Set{Matcher})
    function producer(c::Channel)
        tag = "$(m.name)"
        if (m.matcher === nothing); put!(c, "$(tag) OPEN")
        elseif m in known; put!(c, "$(tag)...")
        else
            put!(c, "$(tag)")
            push!(known, m)
            for (i, line) in enumerate(print_matcher(m.matcher, known))
                put!(c, i == 1 ? "`-$(line)" : "  $(line)")
            end
        end
    end
    Channel(c -> producer(c))
end

function Base.print(io::Base.IO, m::Matcher)
    print(io, join(print_matcher(m), "\n"))
end
