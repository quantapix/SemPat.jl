using MatchCore

function c_left(s::Symbol, ss)
    if Base.isbinaryoperator(s) return s end
    (!(s in ss) ? (push!(ss, s); s) : amp(s)) |> dollar
end
c_left(e::Expr, _) = e.head in add_dollar ? dollar(e) : e
c_left(n::QuoteNode, _) = n.value isa Symbol ? dollar(n) : n
c_left(x, _) = x

c_right(s::Symbol) = Base.isbinaryoperator(s) ? s : dollar(s)
c_right(e::Expr) = e.head in add_dollar ? dollar(e) : e
c_right(n::QuoteNode) = n.value isa Symbol ? n.value : n
c_right(x) = x

const add_dollar = [:(::), :(...)]
  const skips = [:(::), :(...)]

function compile_rule(rule::Rule)::Expr
    le = df_walk(c_left, rule.left, Vector{Symbol}(); skip=skips, skip_call=true) |> quot
    if rule.mode == :dynamic; re = rule.right
    elseif rule.mode == :rewrite || rule.mode == :equational
        re = df_walk(c_right, rule.right; skip=skips, skip_call=true) |> quot
	else
        error(`rule "$e" is not in valid form.\n`)
    end
    :($le => $re)
end

const identity_axiom = :($(quot(dollar(:i))) => i)

function theory_block(t::Vector{Rule})
	tn = Vector{Expr}()
	for r in t
		push!(tn, compile_rule(r))
		if r.mode == :equational
			mirrored = Rule(r.right, r.left, r.expr, r.mode, nothing)
			push!(tn, compile_rule(mirrored))
		end
	end
	block(tn..., identity_axiom)
end

function compile_theory(theory::Vector{Rule}, mod::Module; __source__=LineNumberNode(0))
    parameter = Meta.gensym(:reducing_expression)
    block = theory_block(theory)
    matching = MatchCore.gen_match(parameter, block, __source__, mod)
    matching = MatchCore.AbstractPatterns.init_cfg(matching)
    ex = :(($parameter) -> $matching)
    closure_generator(mod, ex)
end

macro compile_theory(theory)
    gettheory(theory, __module__)
end

function gettheory(var, mod; compile=true)
	t = nothing
    if Meta.isexpr(var, :block) # @matcher begine rules... end
		t = rm_lines(macroexpand(mod, var)).args .|> Rule
	else
		t = mod.eval(var)
	end
	if compile && !(t isa Function); t = compile_theory(t, mod)
	end
	t
end
