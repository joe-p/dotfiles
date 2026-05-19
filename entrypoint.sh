#!/bin/bash
set -e

HOST_IP=$(ip route | awk '/default/ {print $3; exit}')

# Split on comma and start a socat forwarder for each port
IFS=',' read -ra PORT_LIST <<< "$FORWARD_PORTS"
for port in "${PORT_LIST[@]}"; do
    # Trim whitespace
    port="${port//[[:space:]]/}"
    [ -z "$port" ] && continue
    socat TCP-LISTEN:"$port",bind=127.0.0.1,reuseaddr,fork TCP:"$HOST_IP":"$port" &
done

if [ ! -d "$HOME/.dotfiles" ]; then
	git clone --bare https://github.com/joe-p/dotfiles.git $HOME/.dotfiles
	git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME reset HEAD
	git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME submodule update --init --recursive
	git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME checkout .
fi

git --git-dir=$HOME/.dotfiles/ --work-tree=$HOME pull
mise install --dry-run

exec "$@"
