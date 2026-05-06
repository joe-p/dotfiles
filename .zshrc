autoload -Uz compinit && compinit

####################
# variables
####################
if [ -n "${NVIM}" ]; then
    export VISUAL="nvr --remote-wait"
    export EDITOR="nvr --remote-wait"
else
    export VISUAL="nvim"
    export EDITOR="nvim"
fi
export BUN_AGENT_RULE_DISABLED=1
export CLAUDE_CODE_AGENT_RULE_DISABLED=1

####################
# PATH modifications
####################
export PATH="$PATH:$HOME/.local/bin"
export PATH="$HOME/.bun/bin:$PATH"

####################
# mise
####################
eval "$(mise activate zsh)"

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
alias lzg='lazygit'
alias lzd='lazydocker'
alias pn='pnpm'

####################
# Functions
####################

# open in current nvim if in terminal buffer
# https://github.com/mhinz/neovim-remote
function vim {
    if [ -z "${NVIM}" ]; then
        nvim "$@"
    else
        nvr --remote-send "<C-\\><C-n>:ToggleTerm<CR>:e `realpath $1`<CR>"
    fi
}

####################
# Completions
####################

eval `dircolors -b`
zstyle ':completion:*' matcher-list 'm:{a-z}={A-Za-z}'
zstyle ':completion:*' list-colors "${(s.:.)LS_COLORS}"
zstyle ':completion:*' menu no

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

source <(fzf --zsh)

# Lima BEGIN
# Make sure iptables and mount.fuse3 are available
PATH="$PATH:/usr/sbin:/sbin"
export PATH
# Lima END
