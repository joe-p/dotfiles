ARG GITHUB_TOKEN

FROM ubuntu:24.04 as mise-bin

RUN apt-get update && apt-get install -y --no-install-recommends \
	ca-certificates \
	curl


ENV MISE_INSTALL_PATH="/usr/local/bin/mise"

# ENV MISE_VERSION="..."
RUN curl https://mise.run | sh

##############################
# uv tools
##############################
FROM ubuntu:24.04 as mise-uv
ENV GITHUB_TOKEN=${GITHUB_TOKEN}
ENV MISE_CONFIG_DIR="/home/dev/.config/mise"
ENV MISE_CACHE_DIR="/home/dev/.cache/mise"
ENV MISE_DATA_DIR="/home/dev/.local/share/mise"
ENV PATH="/home/dev/.local/share/mise/shims:$PATH"
ENV HOME="/home/dev"
COPY --from=mise-bin /etc/ssl/certs /etc/ssl/certs
COPY --from=mise-bin /etc/ca-certificates /etc/ca-certificates
COPY --from=mise-bin /usr/local/bin/mise /usr/local/bin/mise

RUN mise use -g uv
RUN uv tool dir
RUN uv tool install neovim-remote
RUN uv tool install basedpyright
RUN uv tool install mypy
RUN uv tool install poetry
RUN uv tool install algokit
RUN uv tool install mdformat --with mdformat-gfm
RUN uv tool install yq

##############################
# node tools
##############################
FROM ubuntu:24.04 as mise-node
ENV GITHUB_TOKEN=${GITHUB_TOKEN}
ENV MISE_CONFIG_DIR="/home/dev/.config/mise"
ENV MISE_CACHE_DIR="/home/dev/.cache/mise"
ENV MISE_DATA_DIR="/home/dev/.local/share/mise"
ENV PATH="/home/dev/.local/share/mise/shims:$PATH"
COPY --from=mise-bin /etc/ssl/certs /etc/ssl/certs
COPY --from=mise-bin /etc/ca-certificates /etc/ca-certificates
COPY --from=mise-bin /usr/local/bin/mise /usr/local/bin/mise

RUN mise use -g node@24
RUN npm i -g pnpm
RUN npm i -g pi
run npm i -g @vtsls/language-server@0.3.0

##############################
# system tools
##############################
FROM ubuntu:24.04 as mise-system
ARG GITHUB_TOKEN
ENV MISE_CONFIG_DIR="/home/dev/.config/mise"
ENV MISE_CACHE_DIR="/home/dev/.cache/mise"
ENV MISE_DATA_DIR="/home/dev/.local/share/mise"
ENV PATH="/home/dev/.local/share/mise/shims:$PATH"
COPY --from=mise-bin /etc/ssl/certs /etc/ssl/certs
COPY --from=mise-bin /etc/ca-certificates /etc/ca-certificates
COPY --from=mise-bin /usr/local/bin/mise /usr/local/bin/mise

RUN mise use -g fzf 
RUN mise use -g lazygit
RUN mise use -g lazydocker
RUN mise use -g sd
RUN mise use -g fd
RUN mise use -g neovim
RUN mise use -g ripgrep
RUN mise use -g difftastic
RUN mise use -g tree-sitter
RUN mise use -g harper-ls
RUN mise use -g gitleaks
RUN mise use -g hyperfine
RUN mise use -g jq

##############################
# Rust tools
##############################
FROM ubuntu:24.04 as mise-rust

RUN apt-get update && apt-get install -y --no-install-recommends \
	ca-certificates \
	curl \
	build-essential

ARG GITHUB_TOKEN
ENV MISE_CONFIG_DIR="/home/dev/.config/mise"
ENV MISE_CACHE_DIR="/home/dev/.cache/mise"
ENV MISE_DATA_DIR="/home/dev/.local/share/mise"
ENV PATH="/home/dev/.local/share/mise/shims:$PATH"
ENV HOME="/home/dev"
COPY --from=mise-bin /usr/local/bin/mise /usr/local/bin/mise

RUN mise use -g rust
RUN cargo install --locked circom-lsp@0.1.3

##############################
# rest of system
##############################
FROM ubuntu:24.04

RUN apt-get update && apt-get install -y --no-install-recommends \
	zsh \
	build-essential \
	ca-certificates \
	curl \
	uidmap \ 
	bubblewrap \
	socat \
	libc++-dev \
	libc++abi-dev \
	zlib1g-dev \
	libzstd-dev \
	sudo \
	iproute2 \
	git-all \
	openssh-client\
    	&& rm -rf /var/lib/apt/lists/*

SHELL ["/bin/zsh", "-c"]
WORKDIR /home/dev
ENV HOME=/home/dev

COPY --chown=dev:dev .zshrc .zshrc
COPY --chown=dev:dev .zsh/ .zsh/
COPY --chown=dev:dev .pi/ .pi/
COPY --chown=dev:dev .config/lazygit/ .config/lazygit/
COPY --chown=dev:dev .config/nvim/ .config/nvim/
COPY --chown=dev:dev .gitconfig .gitconfig

ENV MISE_CONFIG_DIR="/home/dev/.config/mise"
ENV MISE_CACHE_DIR="/home/dev/.cache/mise"
ENV MISE_DATA_DIR="/home/dev/.local/share/mise"
ENV PATH="/home/dev/.local/share/mise/shims:$PATH"
ENV PATH="/home/dev/.local/bin:$PATH"

COPY --from=mise-bin /usr/local/bin/mise /usr/local/bin/mise

COPY --from=mise-uv --chown=dev:dev /home/dev/ /home/dev/
COPY --from=mise-node --chown=dev:dev /home/dev/ /home/dev/
COPY --from=mise-rust --chown=dev:dev /home/dev/ /home/dev/
COPY --from=mise-system --chown=dev:dev /home/dev/ /home/dev/

WORKDIR /home/dev/.config/mise/

COPY --from=mise-uv --chown=dev:dev /home/dev/.config/mise/config.toml /home/dev/.config/mise/uv.toml
RUN tail -n +2 uv.toml >> config.toml

COPY --from=mise-node --chown=dev:dev /home/dev/.config/mise/config.toml /home/dev/.config/mise/node.toml
RUN tail -n +2 node.toml >> config.toml

COPY --from=mise-rust --chown=dev:dev /home/dev/.config/mise/config.toml /home/dev/.config/mise/rust.toml
RUN tail -n +2 rust.toml >> config.toml

WORKDIR /home/dev/

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

CMD ["zsh"]
