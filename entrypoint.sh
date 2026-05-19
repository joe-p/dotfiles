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

if [ -z "$REPO_URL" ]; then
    echo "WARN: REPO_URL environment variable is not defined."
elif [ -d "/home/dev/git/$REPO_NAME" ]; then
    echo "INFO: Directory /home/dev/git/$REPO_NAME already exists. Skipping clone of $REPO_URL"
else
    mkdir /home/dev/git && git clone "$REPO_URL" /home/dev/git/"$REPO_NAME"
fi

exec "$@"
