# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
# Initialization code that may require console input (password prompts, [y/n]
# confirmations, etc.) must go above this block; everything else may go below.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi
source /opt/homebrew/opt/powerlevel10k/powerlevel10k.zsh-theme

# To customize prompt, run `p10k configure` or edit ~/.p10k.zsh.
[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh

export PATH="$PATH:/Applications/Visual Studio Code.app/Contents/Resources/app/bin"
export PATH=/opt/homebrew/bin:$PATH

# Add brew auto completions
if type brew &>/dev/null
then
  FPATH="$(brew --prefix)/share/zsh/site-functions:${FPATH}"

  autoload -Uz compinit
  compinit
fi

# pipx autocomplete
autoload -U bashcompinit
bashcompinit
eval "$(register-python-argcomplete pipx)"

# Load asdf
. /opt/homebrew/opt/asdf/libexec/asdf.sh

alias algodeploy="~/git/joe-p/algodeploy/algodeploy.py"
# Created by `pipx` on 2022-11-16 14:19:09
export PATH="$PATH:/Users/joe/.local/bin"

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

