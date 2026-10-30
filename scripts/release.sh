#!/bin/bash
# Build a universal macOS app and publish it as a GitHub release asset.
#   scripts/release.sh v0.1.0 [--skip-build]
# install.sh downloads releases/latest/download/Nanran-macos-universal.zip, so keep that name.
set -euo pipefail

TAG="${1:?usage: scripts/release.sh <tag> [--skip-build]}"
REPO="${NANRAN_REPO:-sionic-ai/paper-desktop}"
ASSET="Nanran-macos-universal.zip"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/src-tauri/target/universal-apple-darwin/release/bundle/macos/Nanran.app"
OUT="$ROOT/src-tauri/target/$ASSET"

cd "$ROOT"
if [ "${2:-}" != "--skip-build" ]; then
  rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null
  pnpm install --frozen-lockfile
  pnpm tauri build --target universal-apple-darwin
fi
[ -d "$APP" ] || { echo "missing $APP" >&2; exit 1; }

lipo -archs "$APP/Contents/MacOS/nanran"
codesign --verify --deep "$APP"
rm -f "$OUT"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUT"
shasum -a 256 "$OUT"

VERSION="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP/Contents/Info.plist")"
NOTES="Nanran $VERSION (macOS universal, ad-hoc signed).

Install: \`curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash\`"

if gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" "$OUT" -R "$REPO" --clobber
else
  gh release create "$TAG" "$OUT" -R "$REPO" --title "Nanran $VERSION" --notes "$NOTES" --target main
fi
echo "released $TAG -> https://github.com/$REPO/releases/tag/$TAG"
