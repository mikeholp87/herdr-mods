#!/usr/bin/env bash
# Installs the hover-focus mod into the Herdr app home. Linux and macOS run it directly;
# under Git Bash / MSYS / Cygwin it hands off to install.ps1 (Windows).
#   ./install.sh [--layout NAME] [--home DIR]
# --layout NAME  also point that layout's pane header at the mod (a backup is kept) and switch to it.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

case "$(uname -s)" in
MINGW* | MSYS* | CYGWIN*)
	exec powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$here/install.ps1")" "$@"
	;;
esac

die() {
	echo "error: $*" >&2
	exit 1
}

layout=""
home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
while [ $# -gt 0 ]; do
	case "$1" in
	--layout) layout="${2:?--layout needs a name}" && shift 2 ;;
	--home) home="${2:?--home needs a folder}" && shift 2 ;;
	-h | --help) sed -n '2,5p' "$0" && exit 0 ;;
	*) die "unknown option: $1" ;;
	esac
done

[ -d "$home" ] || die "Herdr app home not found: $home. Start Herdr once, or pass --home DIR (or set HERDR_APP_HOME)."

mkdir -p "$home/mods"
rm -rf "$home/mods/hover-focus"
cp -R "$here/mods/hover-focus" "$home/mods/hover-focus"
echo "installed: $home/mods/hover-focus"

if command -v herdr-app >/dev/null 2>&1; then
	HERDR_APP_HOME="$home" herdr-app check "$home/mods/hover-focus"
else
	echo "note: herdr-app not on PATH, skipped 'herdr-app check'"
fi

if [ -n "$layout" ]; then
	file="$home/layouts/$layout.json"
	[ -f "$file" ] || die "no such layout: $file"
	command -v jq >/dev/null 2>&1 || die "jq is needed for --layout. Install jq, or edit $file by hand (see README)."
	cp "$file" "$file.bak-before-hover-focus"
	tmp=$(mktemp)
	jq '(.. | objects | select((.header? | type) == "object" and (.header | has("content"))) | .header)
	    |= (. + {content: {mod: "hover-focus"}, reveal: "always", height: 30, position: "top"})' "$file" >"$tmp"
	mv "$tmp" "$file"
	echo "layout updated: $file (backup: $file.bak-before-hover-focus)"
	if command -v herdr-app >/dev/null 2>&1; then
		HERDR_APP_HOME="$home" herdr-app "do" layout.switch --name "$layout" || true
	fi
else
	echo "next: point a layout's pane header at the mod (see README), or re-run with --layout NAME"
fi
