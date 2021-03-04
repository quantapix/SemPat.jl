using Qnarre.Lens
using Test

molecule = (name = "water",
    atoms = [
        (name = "H", position = (x = 0, y = 1)), # in reality the angle is about 104deg
        (name = "O", position = (x = 0, y = 0)),
        (name = "H", position = (x = 1, y = 0)),
    ])

oc = @lens _.atoms |> Elems() |> _.position.x
res_modify = modify(x -> x + 1, molecule, oc)

res_macro = @set molecule.atoms |> Elems() |> _.position.x += 1
@test res_macro == res_modify

res_expected = (name = "water",
    atoms = [
        (name = "H", position = (x = 1, y = 1)),
        (name = "O", position = (x = 1, y = 0)),
        (name = "H", position = (x = 2, y = 0)),
    ])

@test res_expected == res_macro

res_set = set(molecule, oc, 4.0)
res_macro = @set molecule.atoms |> Elems() |> _.position.x = 4.0
@test res_macro == res_set

res_expected = (name = "water",
    atoms = [
        (name = "H", position = (x = 4.0, y = 1)),
        (name = "O", position = (x = 4.0, y = 0)),
        (name = "H", position = (x = 4.0, y = 0)),
    ])
@test res_expected == res_set
