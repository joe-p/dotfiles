# .bashrc

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

# Uncomment the following line if you don't like systemctl's auto-paging feature:
# export SYSTEMD_PAGER=

# User specific aliases and functions

source ~/.git-prompt.sh

GIT_PS1_SHOWDIRTYSTATE=true
GIT_PS1_SHOWSTASHSTATE=true
GIT_PS1_SHOWUNTRACKEDFILES=true
GIT_PS1_SHOWUPSTREAM="auto"

export PS1="\n\[$(tput smul)\]\w\[$(tput rmul)\]\n\u@\h\$(__git_ps1):\$ \[$(tput cnorm)\]"


#### Aliases

## General
alias dotfiles='/usr/bin/git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME'
alias findf="find ./ | grep $1"
alias fif="grep -rn"
## Elixir

alias phx='mix ecto.create && mix ecto.migrate && mix phx.server'


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
