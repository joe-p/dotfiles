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

WORKDIR /home/dev

ENV HOME=/home/dev
ENV MISE_CONFIG_DIR="/home/dev/.config/mise"
ENV MISE_CACHE_DIR="/home/dev/.cache/mise"
ENV MISE_DATA_DIR="/home/dev/.local/share/mise"

COPY .config/mise/ /home/dev/.config/mise/

ENV MISE_INSTALL_PATH="/usr/local/bin/mise"
COPY setup-mise.sh setup-mise.sh
RUN bash setup-mise.sh && rm setup-mise.sh

COPY .config/mise/mise.lock /home/dev/.config/mise/mise.lock
RUN --mount=type=secret,id=GITHUB_TOKEN,env=GITHUB_TOKEN \
    mise install --verbose && \
    rm -rf /home/dev/.cache

COPY .config/nvim /home/dev/.config/nvim
RUN .local/share/mise/installs/neovim/latest/bin/nvim --headless -c 'packloadall | quit' && \
    rm -rf .config/nvim

ENV MISE_CONFIG_DIR="/home/dev/.config/mise"
ENV MISE_CACHE_DIR="/home/dev/.cache/mise"
ENV MISE_DATA_DIR="/home/dev/.local/share/mise"
ENV PATH="/home/dev/.local/share/mise/shims:$PATH"
ENV PATH="/home/dev/.local/bin:$PATH"

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

CMD ["zsh"]
