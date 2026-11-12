# dotfiles

This repository uses `$HOME` as its work tree, so tracked paths mirror the
files in your home directory (for example, `.config/nvim` and `.zshrc`).

1. `git clone --bare https://github.com/joe-p/dotfiles.git $HOME/.dotfiles`

2. `alias dotfiles='/usr/bin/git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME'`

3. `dotfiles checkout`

4. `dotfiles submodule update --init --recursive`

To track remote properly: `git --git-dir="$HOME/.dotfiles" config --add remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'`

The submodule is used for the [pure](https://github.com/sindresorhus/pure)
zsh prompt. The `.gitignore` is a whitelist: files in `$HOME` are ignored
unless they are explicitly managed by this repository.
