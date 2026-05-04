#!/usr/bin/env bash

set -euo pipefail

APP_NAME="${APP_NAME:-agent-passport}"
APP_USER="${APP_USER:-agentpassport}"
APP_GROUP="${APP_GROUP:-agentpassport}"
APP_ROOT="${APP_ROOT:-/opt/agent-passport}"
APP_CURRENT_LINK="${APP_CURRENT_LINK:-$APP_ROOT/current}"
APP_RELEASE_DIR="${APP_RELEASE_DIR:-$APP_ROOT/releases/$(date +%Y%m%d%H%M%S)}"
APP_DATA_DIR="${APP_DATA_DIR:-/var/lib/agent-passport}"
APP_ETC_DIR="${APP_ETC_DIR:-/etc/agent-passport}"
DEFAULT_APP_ENV_FILE="$APP_ETC_DIR/agent-passport.env"
APP_ENV_FILE="${APP_ENV_FILE:-$DEFAULT_APP_ENV_FILE}"
APP_SERVICE_PATH="${APP_SERVICE_PATH:-/etc/systemd/system/$APP_NAME.service}"
SOURCE_DIR="${SOURCE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

read_env_value() {
  local key="$1"
  local line=""
  if [ ! -f "$APP_ENV_FILE" ]; then
    return 0
  fi
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$APP_ENV_FILE" | tail -n 1 || true)"
  line="${line#export }"
  line="${line#${key}=}"
  line="${line%\"}"
  line="${line#\"}"
  line="${line%\'}"
  line="${line#\'}"
  printf '%s' "$line"
}

normalize_loopback_host() {
  local host="$1"
  host="${host#[}"
  host="${host%]}"
  case "$host" in
    ""|"0.0.0.0"|"::"|"::0"|"*")
      printf '127.0.0.1'
      ;;
    *)
      printf '%s' "$host"
      ;;
  esac
}

echo "[1/8] ensure service account"
if ! getent group "$APP_GROUP" >/dev/null 2>&1; then
  sudo groupadd --system "$APP_GROUP"
fi
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  sudo useradd --system --gid "$APP_GROUP" --home-dir "$APP_ROOT" --create-home --shell /usr/sbin/nologin "$APP_USER"
fi

echo "[2/8] ensure runtime directories"
sudo mkdir -p "$APP_ROOT/releases" "$APP_DATA_DIR" "$APP_ETC_DIR"
sudo chown -R "$APP_USER:$APP_GROUP" "$APP_ROOT" "$APP_DATA_DIR"
sudo chmod 750 "$APP_ROOT" "$APP_DATA_DIR"
sudo chmod 755 "$APP_ROOT/releases"
sudo chmod 700 "$APP_ETC_DIR"

echo "[3/8] sync application release"
sudo mkdir -p "$APP_RELEASE_DIR"
sudo rsync -a \
  --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'data' \
  --exclude 'deploy/.env' \
  "$SOURCE_DIR"/ "$APP_RELEASE_DIR"/
sudo chown -R "$APP_USER:$APP_GROUP" "$APP_RELEASE_DIR"
sudo ln -sfn "$APP_RELEASE_DIR" "$APP_CURRENT_LINK"
sudo chown -h "$APP_USER:$APP_GROUP" "$APP_CURRENT_LINK"

echo "[4/8] install env template if missing"
if [ ! -f "$APP_ENV_FILE" ]; then
  sudo cp "$SOURCE_DIR/deploy/agent-passport.systemd.env.example" "$APP_ENV_FILE"
  sudo chmod 600 "$APP_ENV_FILE"
  echo "created $APP_ENV_FILE"
else
  echo "keep existing $APP_ENV_FILE"
fi

echo "[5/8] patch env file paths"
sudo sed -i.bak \
  -e "s|^AGENT_PASSPORT_LEDGER_PATH=.*|AGENT_PASSPORT_LEDGER_PATH=$APP_DATA_DIR/ledger.json|" \
  -e "s|^AGENT_PASSPORT_RECOVERY_DIR=.*|AGENT_PASSPORT_RECOVERY_DIR=$APP_DATA_DIR/recovery-bundles|" \
  -e "s|^AGENT_PASSPORT_ARCHIVE_DIR=.*|AGENT_PASSPORT_ARCHIVE_DIR=$APP_DATA_DIR/archives|" \
  -e "s|^AGENT_PASSPORT_SETUP_PACKAGE_DIR=.*|AGENT_PASSPORT_SETUP_PACKAGE_DIR=$APP_DATA_DIR/device-setup-packages|" \
  "$APP_ENV_FILE"
sudo chmod 600 "$APP_ENV_FILE"

echo "[6/8] install systemd unit"
sudo sed \
  -e "s|^User=.*|User=$APP_USER|" \
  -e "s|^Group=.*|Group=$APP_GROUP|" \
  -e "s|^WorkingDirectory=.*|WorkingDirectory=$APP_CURRENT_LINK|" \
  -e "s|^EnvironmentFile=.*|EnvironmentFile=$APP_ENV_FILE|" \
  -e "s|^ReadWritePaths=.*|ReadWritePaths=$APP_DATA_DIR|" \
  "$SOURCE_DIR/deploy/agent-passport.service.example" | sudo tee "$APP_SERVICE_PATH" >/dev/null

echo "[7/8] install production dependencies"
if [ -f "$APP_CURRENT_LINK/package-lock.json" ]; then
  sudo -u "$APP_USER" env HOME="$APP_ROOT" npm --prefix "$APP_CURRENT_LINK" ci --omit=dev
else
  sudo -u "$APP_USER" env HOME="$APP_ROOT" npm --prefix "$APP_CURRENT_LINK" install --omit=dev
fi

echo "[8/8] reload and start service"
sudo systemctl daemon-reload
sudo systemctl enable --now "$APP_NAME"
sudo systemctl status "$APP_NAME" --no-pager || true

APP_LOCAL_BASE_URL="$(read_env_value AGENT_PASSPORT_SELF_HOSTED_LOCAL_BASE_URL)"
if [ -z "$APP_LOCAL_BASE_URL" ]; then
  APP_LOCAL_PORT="$(read_env_value AGENT_PASSPORT_SELF_HOSTED_LOCAL_PORT)"
  APP_LOCAL_PORT="${APP_LOCAL_PORT:-$(read_env_value PORT)}"
  APP_LOCAL_PORT="${APP_LOCAL_PORT:-4319}"
  APP_LOCAL_HOST="$(normalize_loopback_host "$(read_env_value HOST)")"
  APP_LOCAL_BASE_URL="http://${APP_LOCAL_HOST}:${APP_LOCAL_PORT}"
fi

if [ "$APP_ENV_FILE" = "$DEFAULT_APP_ENV_FILE" ]; then
  APP_VERIFY_GO_LIVE_COMMAND="npm run verify:go-live:self-hosted"
else
  APP_VERIFY_GO_LIVE_COMMAND="AGENT_PASSPORT_DEPLOY_ENV_FILE=\"$APP_ENV_FILE\" npm run verify:go-live:self-hosted"
fi

cat <<EOF

bootstrap complete

next:
  1. edit $APP_ENV_FILE and replace placeholder secrets
     note: deploy/.env is intentionally excluded from release sync; target-host canonical env file is $APP_ENV_FILE
  2. restart service: sudo systemctl restart $APP_NAME
  3. verify local health:
     curl $APP_LOCAL_BASE_URL/api/health
     curl $APP_LOCAL_BASE_URL/api/security
  4. once domain and token are written into $APP_ENV_FILE:
     cd $APP_CURRENT_LINK
     $APP_VERIFY_GO_LIVE_COMMAND

logs:
  sudo journalctl -u $APP_NAME -n 100 --no-pager

rollback:
  sudo ln -sfn /path/to/previous-release $APP_CURRENT_LINK
  sudo systemctl restart $APP_NAME
EOF
