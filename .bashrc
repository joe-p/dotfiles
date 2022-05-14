# .bashrc
export BASH_SILENCE_DEPRECATION_WARNING=1

# Source global definitions
if [ -f /etc/bashrc ]; then
	. /etc/bashrc
fi

# User specific environment
if ! [[ "$PATH" =~ "$HOME/.local/bin:$HOME/bin:" ]]
then
    PATH="$HOME/.local/bin:$HOME/bin:$PATH"
fi
export PATH

# don't put duplicate lines or lines starting with space in the history.
# See bash(1) for more options
HISTCONTROL=erasedups

# append to the history file, don't overwrite it
shopt -s histappend

# for setting history length see HISTSIZE and HISTFILESIZE in bash(1)
HISTSIZE=1000
HISTFILESIZE=2000

# check the window size after each command and, if necessary,
# update the values of LINES and COLUMNS.
shopt -s checkwinsize

# If set, the pattern "**" used in a pathname expansion context will
# match all files and zero or more directories and subdirectories.
shopt -s globstar 2> /dev/null

[ -f "$HOME/.asdf/asdf.sh" ] && . $HOME/.asdf/asdf.sh
[ -f "$HOME/.asdf/completions/asdf.bash" ] && . $HOME/.asdf/completions/asdf.bash

source ~/.git-prompt.sh

GIT_PS1_SHOWDIRTYSTATE=true
GIT_PS1_SHOWSTASHSTATE=true
GIT_PS1_SHOWUNTRACKEDFILES=true
GIT_PS1_SHOWUPSTREAM="auto"

export PS1="\n\[$(tput smul)\]\w\[$(tput rmul)\]\n\u@\h\$(__git_ps1):\$ \[$(tput cnorm)\]"

#### Aliases

## General
alias dotfiles='/usr/bin/git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME'

#### Functions
function ps1_help(){
  echo "Git:"
  echo "   * => unstaged"
  echo "   + => staged"
  echo "   $ => stashed"
  echo "   % => untracked"
  echo "   > => ahead"
  echo "   < => behind"
  echo "  <> => diverged"
  echo "   = => no difference"
}

