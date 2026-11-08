#!/usr/bin/env bash
# 디스코드 봇 토큰을 /opt/guild/.env 에 저장하고 봇을 재시작한다. root 로 실행.
#   ssh -t guild-vps bash /opt/guild/deploy/set-token.sh
set -euo pipefail

ENV_FILE=/opt/guild/.env

read -rsp "DISCORD_TOKEN 붙여넣기 (화면에 안 보여요): " token
echo
token=$(tr -d '[:space:]' <<<"$token")
[ -n "$token" ] || { echo "토큰이 비어 있어요"; exit 1; }

umask 077
printf 'DISCORD_TOKEN=%s\n' "$token" > "$ENV_FILE"
chown guild:guild "$ENV_FILE"
chmod 600 "$ENV_FILE"

systemctl restart guild-bot
sleep 5
if systemctl is-active --quiet guild-bot; then
    echo "봇 실행 중:"
    journalctl -u guild-bot -n 5 --no-pager -o cat
else
    echo "봇 시작 실패:"
    journalctl -u guild-bot -n 20 --no-pager -o cat
    exit 1
fi
