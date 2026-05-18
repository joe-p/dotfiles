#!/bin/sh
set -e

HOST_IP=$(ip route | awk '/default/ {print $3; exit}')
socat TCP-LISTEN:4001,bind=127.0.0.1,reuseaddr,fork TCP:"$HOST_IP":4001 &
socat TCP-LISTEN:4002,bind=127.0.0.1,reuseaddr,fork TCP:"$HOST_IP":4002 &
socat TCP-LISTEN:8980,bind=127.0.0.1,reuseaddr,fork TCP:"$HOST_IP":8980 &

exec "$@"
