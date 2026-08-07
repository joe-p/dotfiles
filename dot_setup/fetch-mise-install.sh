gpg --keyserver hkps://keys.openpgp.org --recv-keys 24853EC9F655CE80B48E6C3A8B81C9D17413A06D
curl https://mise.jdx.dev/install.sh.sig | gpg --decrypt > mise-install.sh

