#/bin/zsh
set -ex

# Setup dotfiles
git clone --bare https://github.com/joe-p/dotfiles.git $HOME/.dotfiles
/usr/bin/git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME checkout -f
/usr/bin/git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME submodule update --init

# Instal mise
gpg --keyserver hkps://keys.openpgp.org --recv-keys 24853EC9F655CE80B48E6C3A8B81C9D17413A06D
curl https://mise.en.dev/install.sh.sig | gpg --decrypt > install.sh
sh ./install.sh
eval "$($HOME/.local/bin/mise activate zsh)"

# Install mise tools
mise install

source ~/.zshrc

# Intall python tools
pip install pipx
pipx install neovim-remote

# Setup pi
cd ~/.pi/agent/extensions/ && pnpm install
cd ~/.pi/agent/extensions/1000-lsp && pnpm install


