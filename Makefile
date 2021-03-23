# sudo apt-get install build-essential libatomic1 python gfortran perl wget m4 cmake pkg-config curl

OTHER=qblk:~/other

.PHONY: clone go julia rust

clone: 
	(cd /usr/local/qpx || exit; \
		[ -e go ] || git clone -b release-branch.go1.16 --depth 1 $(OTHER)/go/go || exit; \
	)
	mkdir -p raw
	(cd raw || exit; \
		[ -e julia ] || git clone -b release-1.6 --depth 1 $(OTHER)/jl/julia || exit; \
		[ -e julia-vscode ] || git clone --depth 1 $(OTHER)/jl/julia-vscode || exit; \
		[ -e OhMyREPL.jl ] || git clone --depth 1 $(OTHER)/jl/OhMyREPL.jl || exit; \
		[ -e Revise.jl ] || git clone --depth 1 $(OTHER)/jl/Revise.jl || exit; \
		[ -e rust ] || git clone --depth 1 $(OTHER)/rs/rust || exit; \
		[ -e typescript ] || git clone --depth 1 $(OTHER)/ts/typescript || exit; \
	)

go: clone
	(cd /usr/local/qpx/go || exit; \
		git pull; \
		cd src; \
		./all.bash; \
	)

julia: clone
	(cd raw/julia || exit; \
		git pull; \
		cp ../../Make.jl.user Make.user; \
		make -j $(nproc); \
		make install prefix=/usr/local/qpx; \
	)

rust: clone
	(cd raw/rust || exit; \
		git pull; \
		cp ../../rust.config.toml config.toml; \
		./x.py build && ./x.py install; \
		./x.py install cargo; \
	)

typescript: clone
	(cd raw/typescript || exit; \
		git pull; \
	)
