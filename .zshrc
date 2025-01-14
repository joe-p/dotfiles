####################
# Installations
####################

# zoxide
# curl -sSfL https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | sh

####################
# PATH modifications
####################

export PATH="$PATH:/Applications/Visual Studio Code.app/Contents/Resources/app/bin"
export PATH=/opt/homebrew/bin:$PATH
export PATH="$PATH:/Users/joe/.local/bin"
# export PATH="/opt/homebrew/opt/llvm/bin:$PATH"


####################
# go
####################
export GOPATH="$HOME/go"

####################
# Emscripten
####################
export EMSDK_QUIET=1
source "/Users/joe/git/other/emsdk/emsdk_env.sh"

####################
# Aliases
####################
alias ls='ls --color'
alias dotfiles='/usr/bin/git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME'
alias vim='nvim'
alias code='cursor'
alias lzg='lazygit'
alias lzd='lazydocker'
alias og='cursor `tv git-repos`'

####################
# brew
####################

# Add brew auto completions
if type brew &>/dev/null
then
  FPATH="$(brew --prefix)/share/zsh/site-functions:${FPATH}"
fi

####################
# JetBrains
####################

edit() {
    if [[ -v $PYCHARM_TERMINAL ]]
    then
        touch $1 && pycharm $1
    elif [[ -v $RUBYMINE_HOSTED ]]
    then
        touch $1 && rubymine $1
    else
        code
    fi
}

####################
# Completions
####################

zstyle ':completion:*' matcher-list 'm:{a-z}={A-Za-z}'
zstyle ':completion:*' list-colors "${(s.:.)LS_COLORS}"
zstyle ':completion:*' menu no
zstyle ':fzf-tab:complete:cd:*' fzf-preview 'ls --color $realpath'
zstyle ':fzf-tab:complete:__zoxide_z:*' fzf-preview 'ls --color $realpath'

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
# Shell Integrations
####################
eval "$(fzf --zsh)"
eval "$(zoxide init --cmd cd zsh)"

####################
# Pure
####################
fpath+=($HOME/.zsh/pure)
autoload -U promptinit; promptinit
zstyle :prompt:pure:git:stash show yes
prompt pure
