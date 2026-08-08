#!/usr/bin/env bash

echo "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBBg28htJKdbNv5sZLuxoAB3Afzx5IPbB0nIEjLOZhGMHQS/Igsy6A77kB108sbaNpSgIUiG5FNbFBprauwaSNyE= sudo@secretive.Joe’s-MacBook-Pro.local" >> /etc/security/authorized_keys

apt-get install -y libpam-ssh-agent-auth
sed -i '1iauth sufficient pam_ssh_agent_auth.so file=/etc/security/authorized_keys' /etc/pam.d/sudo-i
sed -i '1iauth sufficient pam_ssh_agent_auth.so file=/etc/security/authorized_keys' /etc/pam.d/sudo

echo "Defaults env_keep += "SSH_AUTH_SOCK"" >> /etc/sudoers.d/999-force-auth
echo "joe ALL=(ALL) ALL" >> /etc/sudoers.d/9999-ssh-agent-auth
chmod 0440 /etc/sudoers.d/999-force-auth 
