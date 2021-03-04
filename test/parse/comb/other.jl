
# compare stack depth to trampoline depth

function stack(n, m)
    if n > m
        n
    else
        if n % 1000 == 0
#            println("stack $n")
        end
        n + stack(n+1, m)
    end
end

stack(0, 10)
@time println(stack(0, 100_000))

abstract Msg

type Call<:Msg
    before::Function
    after::Function
    value::Int
end

type Return<:Msg
    value::Int
end
   
function inc(n, m)
    if n > m
        Return(n)
    else
        if n % 1000 == 0
#            println("trampoline $n")
        end
        Call(inc, (x, m) -> Return(n+x), n+1)
    end
end

function sum(n, m)
    Return(n)
end
function trampoline(n, m)
    stack = Function[inc]
    while length(stack) > 0
        f = pop!(stack)
        msg = f(n, m)
        if isa(msg, Call)
            push!(stack, msg.after)
            push!(stack, msg.before)
        end
        n = msg.value
    end
    n
end
    

trampoline(0, 10)
@time println(trampoline(0, 100_000))
@time println(trampoline(0, 1_000_000))
@time println(trampoline(0, 10_000_000))

using AutoHashEquals

abstract Graph

@auto_hash_equals type Node<:Graph
    label::AbstractString
    children::Vector{Graph}
    Node(label, children...) = new(label, Graph[children...])
end

type Cycle<:Graph
    node::Union{Graph,Nothing}
    Cycle() = new(nothing)
end

function gprint(known::Set{Graph}, n::Node)
    function producer()
        if n in known
            produce(string(n.label, "..."))
        else
            push!(known, n)
            produce(n.label)
            for child in n.children
                prefix = child == n.children[end] ? "`-" : "+-"
                for line in gprint(known, child)
                    produce(string(prefix, line))
                    prefix = child == n.children[end] ? "  " : "| y"
                end
            end
            delete!(known, n)
        end
    end
    Task(producer)
end

function gprint(known::Set{Graph}, c::Cycle)
    if isnull(c.node)
        Task(() -> produce("?"))
    elseif c in known
        Task(() -> produce("..."))
    else
        push!(known, c)
        t = gprint(known, get(c.node))
        delete!(known, c)
        t
    end
end

function Base.print(io::Base.IO, g::Graph)
    for line in gprint(Set{Graph}(), g)
        println(io, line)
    end
end

x = Cycle()
g = Node("a", 
         Node("b"),
         Node("c",
              x,
              Node("d")))
print(g)

x.node = g
print(g)

# compare exceptions to returning a type

function run_exception(n)
  count = 0
  for i in 1:n
      try
          random_exception()
      catch
          count += 1
      end
  end
  println("exceptions: $count")
end

function random_exception()
  if rand(1:2) == 1
      error()
  end
end

function run_type(n)
  count = 0
  for i in 1:n
      if isa(random_type(), A)
          count += 1
      end
  end
  println("types: $count")
end

type A end
type B end

function random_type()
  if rand(1:2) == 1
      A()
  else
      B()
  end
end

run_exception(10)
run_type(10)
@time run_exception(1000)
@time run_type(1000)
@time run_exception(1000)
@time run_type(1000)


# exceptions are much slower

# exceptions: 521
#  33.651 milliseconds (703 allocations: 20269 bytes)
# types: 519
# 225.958 microseconds (31 allocations: 1248 bytes)
# exceptions: 518
#  33.506 milliseconds (549 allocations: 9552 bytes)
# types: 498
# 205.418 microseconds (30 allocations: 1232 bytes)
