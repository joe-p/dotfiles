#!/bin/sh

git clone --bare https://github.com/joe-p/dotfiles.git $HOME/.dotfiles
git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME checkout -f
git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME submodule update --init
