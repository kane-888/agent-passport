#!/usr/bin/env bash

set -euo pipefail

APP_NAME="${APP_NAME:-agent-passport}"
APP_DATA_DIR="${APP_DATA_DIR:-/var/lib/agent-passport}"
APP_ETC_DIR="${APP_ETC_DIR:-/etc/agent-passport}"
APP_BACKUP_DIR="${APP_BACKUP_DIR:-/var/backups/agent-passport}"
APP_BACKUP_RETENTION_DAYS="${APP_BACKUP_RETENTION_DAYS:-14}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive_name="${APP_NAME}-${timestamp}.tar.gz"
tmp_dir="$(mktemp -d)"
tmp_archive="$tmp_dir/$archive_name"

cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

sources=()
if [ -d "$APP_DATA_DIR" ]; then
  sources+=("${APP_DATA_DIR#/}")
fi
if [ -d "$APP_ETC_DIR" ]; then
  sources+=("${APP_ETC_DIR#/}")
fi

if [ "${#sources[@]}" -eq 0 ]; then
  echo "no backup sources found: $APP_DATA_DIR / $APP_ETC_DIR" >&2
  exit 2
fi

install -d -m 700 "$APP_BACKUP_DIR"
tar -C / -czf "$tmp_archive" "${sources[@]}"
chmod 600 "$tmp_archive"
mv "$tmp_archive" "$APP_BACKUP_DIR/$archive_name"

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$APP_BACKUP_DIR/$archive_name" > "$APP_BACKUP_DIR/$archive_name.sha256"
else
  shasum -a 256 "$APP_BACKUP_DIR/$archive_name" > "$APP_BACKUP_DIR/$archive_name.sha256"
fi
chmod 600 "$APP_BACKUP_DIR/$archive_name.sha256"

find "$APP_BACKUP_DIR" -type f -name "${APP_NAME}-*.tar.gz" -mtime +"$APP_BACKUP_RETENTION_DAYS" -delete
find "$APP_BACKUP_DIR" -type f -name "${APP_NAME}-*.tar.gz.sha256" -mtime +"$APP_BACKUP_RETENTION_DAYS" -delete

echo "backup written: $APP_BACKUP_DIR/$archive_name"
