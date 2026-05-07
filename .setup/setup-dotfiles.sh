#!/bin/sh

git clone --bare https://github.com/joe-p/dotfiles.git $HOME/.dotfiles
git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME checkout -f
git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME submodule update --init
git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME remote remove origin
git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME remote add origin git@github.com:joe-p/dotfiles.git

