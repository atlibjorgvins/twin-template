#!/usr/bin/env bash
# Package the built Twin.app into a .dmg WITHOUT the Finder-layout AppleScript.
#
# Tauri's dmg bundler (bundle_dmg.sh) runs an osascript that asks Finder to
# arrange the disk-image window's icons. On machines with FinderSync
# extensions (Synology Drive, Adobe) that AppleScript reliably hangs, stalling
# the whole build. This produces the same installable dmg with plain hdiutil —
# a drag-to-Applications window, no custom background — deterministically.
#
#   npm run build:desktop && tauri build --bundles app   # make Twin.app
#   bash scripts/make-dmg.sh                              # then this
set -euo pipefail

APP="src-tauri/target/release/bundle/macos/Twin.app"
[ -d "$APP" ] || { echo "✗ $APP not found — build the app first" >&2; exit 1; }
VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")
OUT="src-tauri/target/release/bundle/dmg/Twin_${VERSION}_aarch64.dmg"
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"

# Detach any stale Twin mounts/images that could block a fresh attach.
# (Guarded: empty globs / no matches must not trip `set -o pipefail`.)
for v in /Volumes/Twin*; do [ -e "$v" ] && hdiutil detach "$v" -force >/dev/null 2>&1 || true; done
{ hdiutil info 2>/dev/null | grep '/dev/disk' | grep -i twin | awk '{print $1}' || true; } | while read -r d; do
  hdiutil detach "$d" -force >/dev/null 2>&1 || true
done

STAGE=$(mktemp -d)
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"   # drag-to-install target

hdiutil create -volname "Twin" -srcfolder "$STAGE" -ov -format UDZO "$OUT" >/dev/null
rm -rf "$STAGE"
ls -lh "$OUT" | awk '{print $5, $9}'
