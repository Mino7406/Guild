#!/usr/bin/env bash
# 새 서버(Debian 12)에 Guild 봇을 처음 설치한다. root 로 한 번만 실행.
#   bash setup.sh
# 끝나면 /opt/guild/.env 에 DISCORD_TOKEN=... 을 넣고 `systemctl start guild-bot`.
set -euo pipefail

APP_DIR=/opt/guild
APP_USER=guild
REPO=https://github.com/Mino7406/Guild.git
NODE_MAJOR=22

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q git curl ca-certificates gnupg

# Node.js (NodeSource 공식 apt 저장소)
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
    install -d -m 755 /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
    apt-get update -q
    apt-get install -y -q nodejs
fi
echo "node $(node -v), npm $(npm -v)"

# 봇 전용 사용자 (root 로 봇을 돌리지 않음)
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/home/$APP_USER" --shell /usr/sbin/nologin "$APP_USER"

if [ ! -d "$APP_DIR/.git" ]; then
    install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
    runuser -u "$APP_USER" -- env HOME="/home/$APP_USER" git clone --quiet "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
runuser -u "$APP_USER" -- env HOME="/home/$APP_USER" npm ci --omit=dev --no-audit --no-fund

install -m 644 deploy/guild-bot.service deploy/guild-deploy.service deploy/guild-deploy.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable guild-bot.service
systemctl enable --now guild-deploy.timer

if [ -f "$APP_DIR/.env" ]; then
    systemctl restart guild-bot
    echo "설치 완료, 봇 실행 중"
else
    echo "설치 완료. $APP_DIR/.env 에 DISCORD_TOKEN 을 넣은 뒤: systemctl start guild-bot"
fi
