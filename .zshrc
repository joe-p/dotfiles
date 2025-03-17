autoload -Uz compinit && compinit

####################
# variables
####################
export GOPATH="$HOME/go"
if [ -n "${NVIM}" ]; then
    export VISUAL="nvr --remote-wait +'set bufhidden=wipe'"
    export EDITOR="nvr --remote-wait +'set bufhidden=wipe'"
else
    export VISUAL="nvim"
    export EDITOR="nvim"
fi

####################
# PATH modifications
####################

export PATH="$PATH:/Applications/Visual Studio Code.app/Contents/Resources/app/bin"
export PATH=/opt/homebrew/bin:$PATH
export PATH="$PATH:/Users/joe/.local/bin"
export PATH=$GOPATH/bin:$PATH
# export PATH="/opt/homebrew/opt/llvm/bin:$PATH"
export PATH="/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH"

####################
# Emscripten
####################
# export EMSDK_QUIET=1
# source "/Users/joe/git/other/emsdk/emsdk_env.sh"

####################
# Aliases
####################
alias ls='ls --color'
alias dotfiles='/usr/bin/git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME'
alias code='cursor'
alias lzg='lazygit'
alias lzd='lazydocker'

####################
# Functions
####################

# open in current nvim if in terminal buffer
# https://github.com/mhinz/neovim-remote
function vim {
    if [ -z "${NVIM}" ]; then
        nvim "$@"
    else
        nvr --remote-wait +'set bufhidden=wipe' "$@"
    fi
}

####################
# brew
####################

# Add brew auto completions
if type brew &>/dev/null
then
  FPATH="$(brew --prefix)/share/zsh/site-functions:${FPATH}"
fi

####################
# Completions
####################

eval `dircolors -b`
zstyle ':completion:*' matcher-list 'm:{a-z}={A-Za-z}'
zstyle ':completion:*' list-colors "${(s.:.)LS_COLORS}"
zstyle ':completion:*' menu no

if [[ "$TERM_PROGRAM" == "vscode" ]]; then
  eval "$($HOME/.local/bin/mise activate zsh --shims)"
else
  eval "$($HOME/.local/bin/mise activate zsh)"
fi

####################
# History
####################

HISTSIZE=5000
HISTFILE=~/.zsh_history
SAVEHIST=$HISTSIZE
HISTDUP=erase
setopt appendhistory
setopt sharehistory
setopt hist_ignore_space
setopt hist_ignore_all_dups
setopt hist_save_no_dups
setopt hist_ignore_dups
setopt hist_find_no_dups

# Make it so up/down arrow keys search history only matching the current command
bindkey '^[[A' history-search-backward
bindkey '^[[B' history-search-forward

####################
# Pure
####################
fpath+=($HOME/.zsh/pure)
autoload -U promptinit; promptinit
zstyle :prompt:pure:git:stash show yes
prompt pure

#####################
# Vi Mode
#####################
source ~/.zsh/zsh-vi-mode/zsh-vi-mode.plugin.zsh
zvm_after_init_commands+=('source <(fzf --zsh)')
