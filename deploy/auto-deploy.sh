#!/usr/bin/env bash
# GitHub main 브랜치에 새 커밋이 있으면 받아서 봇을 재시작한다.
# guild-deploy.timer 가 1분마다 root 로 실행하고, git/npm 은 guild 사용자로 돌린다.
set -euo pipefail

APP_DIR=/opt/guild
APP_USER=guild
BRANCH=main

cd "$APP_DIR"
as_app() { runuser -u "$APP_USER" -- env HOME="/home/$APP_USER" "$@"; }

as_app git fetch --quiet origin "$BRANCH"
LOCAL=$(as_app git rev-parse HEAD)
REMOTE=$(as_app git rev-parse "origin/$BRANCH")
[ "$LOCAL" = "$REMOTE" ] && exit 0

echo "배포 시작: ${LOCAL:0:7} -> ${REMOTE:0:7}"
CHANGED=$(as_app git diff --name-only "$LOCAL" "$REMOTE")
as_app git reset --hard --quiet "origin/$BRANCH"

if grep -qE '^package(-lock)?\.json$' <<<"$CHANGED"; then
    as_app npm ci --omit=dev --no-audit --no-fund
fi

# systemd 설정 파일이 바뀌었으면 다시 설치
if grep -qE '^deploy/.*\.(service|timer)$' <<<"$CHANGED"; then
    install -m 644 deploy/guild-bot.service deploy/guild-deploy.service deploy/guild-deploy.timer /etc/systemd/system/
    systemctl daemon-reload
fi

if [ -f "$APP_DIR/.env" ]; then
    systemctl restart guild-bot
    echo "배포 완료, 봇 재시작: $(as_app git log -1 --format='%h %s')"
else
    echo "배포 완료, 하지만 $APP_DIR/.env 가 없어 봇을 시작하지 않음"
fi
