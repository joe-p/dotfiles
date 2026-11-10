autoload -Uz compinit && compinit

[[ -f "$HOME/.zshrc.local" ]] && source "$HOME/.zshrc.local"

####################
# OS
####################
case "$OSTYPE" in
    darwin*) DOTFILES_OS=mac ;;
    linux*)  DOTFILES_OS=linux ;;
    *)       DOTFILES_OS=unknown ;;
esac

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

unset ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY ANTHROPIC_MODEL
export ANTHROPIC_BASE_URL="http://100.101.224.41:4000"
# ANTHROPIC_CUSTOM_HEADERS should be in .zshrc.local
# export ANTHROPIC_CUSTOM_HEADERS="x-litellm-api-key: Bearer <KEY>" 

####################
# PATH modifications
####################
export PATH="$PATH:$HOME/.local/bin"
export PATH="$HOME/.bun/bin:$PATH"
export NARGO_HOME="$HOME/.nargo"
export PATH="$PATH:$NARGO_HOME/bin"
export PATH="$HOME/.bb:$PATH"

if [[ "$DOTFILES_OS" == "mac" ]]; then
    export PATH="/opt/homebrew/bin:$PATH"
    export PATH="$PATH:/Applications/Visual Studio Code.app/Contents/Resources/app/bin"
    export PATH="/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH"
    export SSH_AUTH_SOCK="$HOME/Library/Containers/com.maxgoedjen.Secretive.SecretAgent/Data/socket.ssh"

    # Add brew auto completions
    if type brew &>/dev/null; then
        FPATH="$(brew --prefix)/share/zsh/site-functions:${FPATH}"
    fi
elif [[ "$DOTFILES_OS" == "linux" ]]; then
    # Lima: make sure iptables and mount.fuse3 are available
    export PATH="$PATH:/usr/sbin:/sbin"


fi

####################
# mise
####################
if [[ "$TERM_PROGRAM" == "vscode" ]]; then
    eval "$(mise activate zsh --shims)"
else
    eval "$(mise activate zsh)"
fi

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
alias lzdot='lazygit --git-dir=$HOME/.dotfiles/ --work-tree=$HOME'

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

# Edit dotfiles in Neovim with the bare repo as GIT_DIR, so gitsigns and
# lazygit see the dotfiles repository instead of searching from $HOME.
function cme {
    cwd=$(pwd)
    cd "$@"
    GIT_DIR="$HOME/.dotfiles" GIT_WORK_TREE="$HOME" nvim
    cd "$cwd"
}

####################
# Completions
####################

if command -v dircolors >/dev/null 2>&1; then
    eval "$(dircolors -b)"
fi
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
if [[ "$DOTFILES_OS" == "linux" ]]; then
    # Make sure we are using UTF-8 so pure's prompt multi-byte glyph renders correctly
    export LANG=C.UTF-8
    export LC_ALL=C.UTF-8
elif [[ "$DOTFILES_OS" == "mac" ]]; then
    export LANG=en_US.UTF-8
    export LC_ALL=en_US.UTF-8
fi

fpath+=($HOME/.zsh/pure)
autoload -U promptinit; promptinit
PURE_GIT_PULL=0
zstyle :prompt:pure:git:stash show yes

prompt pure

source <(fzf --zsh)
# Lima BEGIN
# Make sure iptables and mount.fuse3 are available
PATH="$PATH:/usr/sbin:/sbin"
export PATH
# Lima END
