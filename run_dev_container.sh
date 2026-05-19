set -x

REPO_NAME=$1
REPO_URL=$2
CONTAINER_NAME=$REPO_NAME-dev

container run \
    --dns 9.9.9.9 \
    --init \
    --ssh \
    -it \
    -e FORWARD_PORTS=4002,4001 \
    -e REPO_NAME=$REPO_NAME \
    -e REPO_URL=$REPO_URL \
    --name $CONTAINER_NAME dev:1 || \
    (container start $CONTAINER_NAME && \
    container exec -it -w /home/dev/git/$REPO_NAME $CONTAINER_NAME zsh)

container stop $CONTAINER_NAME > /dev/null 2>&1 &

