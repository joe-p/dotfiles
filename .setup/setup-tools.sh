#!/bin/zsh
set -ex

if command -v mise >/dev/null 2>&1; then
    echo "mise already installed... skipping"
else
  # Instal mise
  if [ -e "./mise-install.sh" ]; then
    gpg --keyserver hkps://keys.openpgp.org --recv-keys 24853EC9F655CE80B48E6C3A8B81C9D17413A06D
    curl https://mise.en.dev/install.sh.sig | gpg --decrypt > mise-install.sh
  else
      echo "Using existing mise-install.sh..."
  fi

  sh ./mise-install.sh
  eval "$($HOME/.local/bin/mise activate zsh)"
fi

# Install mise tools
mise install

# Intall python tools
uv tool install neovim-remote@2.5.1
uv tool install basedpyright@1.39.3
uv tool install mypy@2.0.0
uv tool install poetry@2.4.0
uv tool install algokit@2.10.2
uv tool install mdformat@1.0.0 --with mdformat-gfm

# Install npm tools
npm install -g @vtsls/language-server@0.3.0

# Install cargo tools
cargo install --locked circom-lsp@0.1.3

# Setup pi
cd ~/.pi/agent/extensions/ && pnpm install
cd ~/.pi/agent/extensions/1000-lsp && pnpm install

