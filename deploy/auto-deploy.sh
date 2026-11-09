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

# 의존성은 package-lock.json 이 바뀔 때만 다시 설치한다 (package.json 의 scripts 같은 부분만 바뀐 경우는 건너뜀).
# npm 이 없으면 봇을 옛 의존성으로 재시작하지 않고 여기서 멈춰 원인을 로그에 남긴다.
if grep -qE '^package-lock\.json$' <<<"$CHANGED"; then
    command -v npm >/dev/null || { echo "오류: package-lock.json 이 바뀌었는데 npm 이 설치돼 있지 않아요" >&2; exit 1; }
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
