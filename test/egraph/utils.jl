@testset "DisjointSet" begin

    @testset "IntDisjointSet" begin
        for T in [Int, UInt8, Int8, UInt16, Int16, UInt32, Int32, UInt64]
            @testset "eltype = $(T)" begin
                s = IntDisjointSet(T(10))
                s2 = IntDisjointSet{T}(10)

                @testset "basic tests" begin
                    @test length(s) == 10
                    @test length(s2) == 10
                    @test eltype(s) == T
                    @test eltype(s2) == T
                    @test eltype(typeof(s)) == T
                    @test eltype(typeof(s2)) == T
                    @test num_groups(s) == T(10)
                    @test num_groups(s2) == T(10)

                    for i = 1:10
                        @test find_root!(s, T(i)) == T(i)
                    end
                    @test_throws BoundsError find_root!(s, T(11))

                    @test !in_same_set(s, T(2), T(3))
                end

                @testset "union!" begin
                    union!(s, T(2), T(3))
                    @test num_groups(s) == T(9)
                    @test in_same_set(s, T(2), T(3))
                    @test find_root!(s, T(3)) == T(2)
                    union!(s, T(3), T(2))
                    @test num_groups(s) == T(9)
                    @test in_same_set(s, T(2), T(3))
                    @test find_root!(s, T(3)) == T(2)
                end

                @testset "more tests" begin
                    # We cannot support arbitrary indexing and still use @inbounds with IntDisjointSet
                    # (and it's not useful anyway)
                    @test_throws MethodError push!(s, T(22))

                    @test push!(s) == T(11)
                    @test num_groups(s) == T(10)

                    @test union!(s, T(8), T(7)) == T(8)
                    @test union!(s, T(5), T(6)) == T(5)
                    @test union!(s, T(8), T(5)) == T(8)
                    @test num_groups(s) == T(7)
                    @test find_root!(s, T(6)) == T(8)
                    union!(s, T(2), T(6))
                    @test find_root!(s, T(2)) == T(8)
                    root1 = find_root!(s, T(6))
                    root2 = find_root!(s, T(2))
                    @test root_union!(s, T(root1), T(root2)) == T(8)
                    @test union!(s, T(5), T(6)) == T(8)
                end
            end
        end
    end

    @testset "IntDisjointSet overflow" begin
        for T in [UInt8, Int8]
            s = IntDisjointSet(T(typemax(T)-1))
            push!(s)
            @test_throws ArgumentError push!(s)
        end
    end
    use indexmap::{indexmap, indexset, IndexMap, IndexSet};

    impl UnionFind {
        pub fn build_sets(&self) -> IndexMap<Id, IndexSet<Id>> {
            let mut map: IndexMap<Id, IndexSet<Id>> = Default::default();

            for i in 0..self.parents.len() {
                let i = Id::from(i);
                let leader = self.find(i);
                map.entry(leader).or_default().insert(i);
            }

            map
        }
    }

    fn make_union_find(n: usize) -> UnionFind {
        let mut uf = UnionFind::default();
        for _ in 0..n {
            uf.make_set();
        }
        uf
    }

    #[test]
    fn union_find() {
        let n = 10;

        fn id(u: usize) -> Id {
            u.into()
        }

        let mut uf = make_union_find(n);

        // test the initial condition of everyone in their own set
        for i in 0..n {
            let i = Id::from(i);
            assert_eq!(uf.find(i), i);
            assert_eq!(uf.find(i), i);
        }

        // make sure build_sets works
        let expected_sets = (0..n)
            .map(|i| (id(i), indexset!(id(i))))
            .collect::<IndexMap<_, _>>();
        assert_eq!(uf.build_sets(), expected_sets);

        // build up one set
        assert_eq!(uf.union(id(0), id(1)), (id(0), id(1)));
        assert_eq!(uf.union(id(1), id(2)), (id(0), id(2)));
        assert_eq!(uf.union(id(3), id(2)), (id(0), id(3)));

        // build up another set
        assert_eq!(uf.union(id(6), id(7)), (id(6), id(7)));
        assert_eq!(uf.union(id(8), id(9)), (id(8), id(9)));
        assert_eq!(uf.union(id(7), id(9)), (id(6), id(8)));

        // make sure union on same set returns to == from
        assert_eq!(uf.union(id(1), id(3)), (id(0), id(0)));
        assert_eq!(uf.union(id(7), id(8)), (id(6), id(6)));

        // check set structure
        let expected_sets = indexmap!(
            id(0) => indexset!(id(0), id(1), id(2), id(3)),
            id(4) => indexset!(id(4)),
            id(5) => indexset!(id(5)),
            id(6) => indexset!(id(6), id(7), id(8), id(9)),
        );
        assert_eq!(uf.build_sets(), expected_sets);

        // all paths should be compressed at this point
        for i in 0..n {
            assert_eq!(uf.parent(id(i)), uf.find(id(i)));
        }
    }
}
