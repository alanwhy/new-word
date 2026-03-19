#!/bin/zsh

set -euo pipefail

SCRIPT_DIR=${0:A:h}
ROOT_DIR=${SCRIPT_DIR:h}
DIST_DIR="$ROOT_DIR/dist"
STAGING_DIR="$ROOT_DIR/build/package"
MANIFEST_PATH="$ROOT_DIR/manifest.json"

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "未找到 manifest.json，无法打包。" >&2
  exit 1
fi

if ! command -v plutil >/dev/null 2>&1; then
  echo "系统缺少 plutil，无法读取版本号。" >&2
  exit 1
fi

VERSION=$(plutil -extract version raw -o - "$MANIFEST_PATH")
ZIP_NAME="new-word-v${VERSION}.zip"
ZIP_PATH="$DIST_DIR/$ZIP_NAME"

INCLUDE_PATHS=(
  "manifest.json"
  "background.js"
  "content.js"
  "content.css"
  "popup.html"
  "popup.js"
  "popup.css"
  "firebase-config.js"
  "icons"
)

mkdir -p "$DIST_DIR"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

for rel_path in "${INCLUDE_PATHS[@]}"; do
  src="$ROOT_DIR/$rel_path"
  if [[ ! -e "$src" ]]; then
    echo "缺少打包文件: $rel_path" >&2
    exit 1
  fi
  cp -R "$src" "$STAGING_DIR/"
done

rm -f "$ZIP_PATH"

(
  cd "$STAGING_DIR"
  ditto -c -k --sequesterRsrc --keepParent . "$ZIP_PATH"
)

echo "打包完成: $ZIP_PATH"