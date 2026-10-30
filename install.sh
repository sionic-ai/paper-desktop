#!/bin/bash
# 나란(Nanran) installer for macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/sionic-ai/paper-desktop/main/install.sh | bash
#
# Steps: download the latest release app -> install to /Applications (or ~/Applications)
#        -> make sure Claude Code CLI is installed and logged in -> open the app.
#
# Options (flags or environment variables, so agents can run it without prompts):
#   --no-claude      NANRAN_NO_CLAUDE=1   skip the Claude Code install/login step
#   --no-login       NANRAN_NO_LOGIN=1    install Claude Code if missing, but never start a login
#   --no-open        NANRAN_NO_OPEN=1     do not open the app at the end
#   --dir <path>     NANRAN_DIR=<path>    install the app into this folder
#   --version <tag>  NANRAN_VERSION=<tag> install a specific release tag (default: latest)
#   --check                               only report what is installed; change nothing
#
# Exit codes: 0 ok (app installed and Claude ready), 1 error, 2 app installed but Claude
#             Code is not logged in yet (run `claude auth login`, then open the app).

set -euo pipefail

REPO="sionic-ai/paper-desktop"
APP_NAME="Nanran.app"
ASSET="Nanran-macos-universal.zip"

NO_CLAUDE="${NANRAN_NO_CLAUDE:-0}"
NO_LOGIN="${NANRAN_NO_LOGIN:-0}"
NO_OPEN="${NANRAN_NO_OPEN:-0}"
DIR="${NANRAN_DIR:-}"
VERSION="${NANRAN_VERSION:-latest}"
CHECK=0

usage() {
  cat <<'EOF'
나란 설치: curl -fsSL https://raw.githubusercontent.com/sionic-ai/paper-desktop/main/install.sh | bash -s -- [options]
  --no-claude      Claude Code 설치·로그인 단계를 건너뛰어요 (NANRAN_NO_CLAUDE=1)
  --no-login       Claude Code가 없으면 설치만 하고 로그인은 시작하지 않아요 (NANRAN_NO_LOGIN=1)
  --no-open        끝나고 앱을 열지 않아요 (NANRAN_NO_OPEN=1)
  --dir <path>     앱을 설치할 폴더 (NANRAN_DIR, 기본 /Applications 또는 ~/Applications)
  --version <tag>  설치할 릴리스 태그 (NANRAN_VERSION, 기본 latest)
  --check          설치 상태만 출력하고 아무것도 바꾸지 않아요
종료 코드: 0 준비 완료, 1 오류, 2 앱은 설치됐지만 Claude Code 로그인이 필요해요
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --no-claude) NO_CLAUDE=1 ;;
    --no-login) NO_LOGIN=1 ;;
    --no-open) NO_OPEN=1 ;;
    --dir) DIR="${2:?--dir needs a path}"; shift ;;
    --version) VERSION="${2:?--version needs a tag}"; shift ;;
    --check) CHECK=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "알 수 없는 옵션이에요: $1" >&2; exit 1 ;;
  esac
  shift
done

say() { printf '\033[1;31m나란\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m나란\033[0m 오류: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "macOS에서만 설치할 수 있어요."
if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ]; then
  fail "sudo 없이 실행해 주세요. 앱과 Claude Code는 사용자 계정에 설치돼요."
fi

find_claude() {
  for c in "$HOME/.local/bin/claude" "$HOME/.claude/local/claude" "$HOME/.npm-global/bin/claude" \
           /opt/homebrew/bin/claude /usr/local/bin/claude; do
    [ -x "$c" ] && { echo "$c"; return 0; }
  done
  command -v claude 2>/dev/null || return 1
}

claude_logged_in() {
  "$1" auth status 2>/dev/null | grep -q '"loggedIn": *true'
}

installed_app() {
  for d in "${DIR:-}" /Applications "$HOME/Applications"; do
    [ -n "$d" ] && [ -d "$d/$APP_NAME" ] && { echo "$d/$APP_NAME"; return 0; }
  done
  return 1
}

if [ "$CHECK" = 1 ]; then
  app="$(installed_app || true)"
  claude="$(find_claude || true)"
  echo "app: ${app:-not installed}"
  if [ -n "$app" ]; then
    echo "app_version: $(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$app/Contents/Info.plist" 2>/dev/null || echo unknown)"
  fi
  echo "claude: ${claude:-not installed}"
  if [ -n "$claude" ]; then
    if claude_logged_in "$claude"; then echo "claude_login: yes"; else echo "claude_login: no"; fi
  fi
  [ -n "$app" ] && [ -n "$claude" ] && claude_logged_in "$claude" && exit 0
  exit 2
fi

# 1. App ------------------------------------------------------------------------------
if [ "$VERSION" = "latest" ]; then
  URL="https://github.com/$REPO/releases/latest/download/$ASSET"
else
  URL="https://github.com/$REPO/releases/download/$VERSION/$ASSET"
fi

if [ -z "$DIR" ]; then
  if [ -w /Applications ]; then DIR=/Applications; else DIR="$HOME/Applications"; fi
fi
mkdir -p "$DIR" || fail "$DIR 폴더를 만들지 못했어요."
DIR="$(cd "$DIR" && pwd -P)"   # resolve symlinks (/var -> /private/var) so the running-copy check matches

TMP="$(mktemp -d "${TMPDIR:-/tmp}/nanran-install.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

say "앱을 내려받는 중이에요 ($VERSION)"
curl -fL --progress-bar --retry 3 -o "$TMP/$ASSET" "$URL" || fail "앱을 내려받지 못했어요: $URL"
ditto -x -k "$TMP/$ASSET" "$TMP/unpacked" || fail "압축을 풀지 못했어요."
[ -d "$TMP/unpacked/$APP_NAME" ] || fail "내려받은 파일에 $APP_NAME 이 없어요."

# Quit only the copy we are about to replace, not a dev build or a copy elsewhere.
if pgrep -f "$DIR/$APP_NAME/Contents/MacOS/nanran" >/dev/null 2>&1; then
  say "실행 중인 나란을 종료해요"
  pkill -f "$DIR/$APP_NAME/Contents/MacOS/nanran" || true
  sleep 1
fi
rm -rf "$DIR/$APP_NAME"
ditto "$TMP/unpacked/$APP_NAME" "$DIR/$APP_NAME" || fail "$DIR 에 앱을 복사하지 못했어요."
# The app is ad-hoc signed, not notarized. Clear the download quarantine so it opens normally.
xattr -dr com.apple.quarantine "$DIR/$APP_NAME" 2>/dev/null || true
say "설치했어요: $DIR/$APP_NAME"

# 2. Claude Code ----------------------------------------------------------------------
STATUS=0
if [ "$NO_CLAUDE" != 1 ]; then
  CLAUDE="$(find_claude || true)"
  if [ -z "$CLAUDE" ]; then
    say "Claude Code가 없어서 공식 설치 스크립트로 설치해요"
    curl -fsSL https://claude.ai/install.sh | bash || fail "Claude Code를 설치하지 못했어요."
    CLAUDE="$(find_claude || true)"
    [ -n "$CLAUDE" ] || fail "Claude Code를 설치했지만 claude 명령을 찾지 못했어요."
  fi
  say "Claude Code: $CLAUDE ($("$CLAUDE" --version 2>/dev/null | head -1))"

  if claude_logged_in "$CLAUDE"; then
    say "Claude Code에 로그인돼 있어요. 번역에 이 계정을 써요"
  elif [ "$NO_LOGIN" != 1 ] && [ -r /dev/tty ] && [ -w /dev/tty ] && ( : < /dev/tty ) 2>/dev/null; then
    say "Claude Code 로그인이 필요해요. 브라우저가 열리면 로그인해 주세요"
    "$CLAUDE" auth login < /dev/tty > /dev/tty 2>&1 || true
    if claude_logged_in "$CLAUDE"; then
      say "로그인했어요"
    else
      say "아직 로그인되지 않았어요. 터미널에서 'claude auth login'을 실행한 뒤 나란을 열어 주세요"
      STATUS=2
    fi
  else
    say "Claude Code 로그인이 필요해요. 터미널에서 'claude auth login'을 실행해 주세요"
    STATUS=2
  fi
fi

# 3. Open -----------------------------------------------------------------------------
if [ "$NO_OPEN" != 1 ]; then
  open "$DIR/$APP_NAME" || say "앱을 열지 못했어요. Finder에서 $DIR/$APP_NAME 을 열어 주세요"
fi
[ "$STATUS" = 0 ] && say "준비됐어요. 왼쪽 칸에 arXiv ID나 검색어를 넣어 보세요"
exit "$STATUS"
