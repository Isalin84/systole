#!/bin/bash
# Собирает ~/Desktop/Systole.app — иконку, которая запускает launch.command.
# Бандл делает osacompile (AppleScript-апплет): у него настоящий Mach-O внутри,
# Launch Services такой запускает; бандл со скриптом вместо исполняемого файла
# на macOS 26 из Finder молча не стартует. Иконка — из tools/icon-src.png.
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Desktop/Systole.app"
TMP="$(mktemp -d)"
rm -rf "$APP"
cat > "$TMP/Systole.applescript" <<SCRIPT
try
  do shell script quoted form of "$DIR/launch.command"
end try
SCRIPT
osacompile -o "$APP" "$TMP/Systole.applescript"
PL="$APP/Contents/Info.plist"
plset() { /usr/libexec/PlistBuddy -c "Delete :$1" "$PL" >/dev/null 2>&1 || true; /usr/libexec/PlistBuddy -c "Add :$1 $2 $3" "$PL"; }
plset CFBundleName string Systole
plset CFBundleDisplayName string Systole
plset CFBundleIdentifier string local.systole.launcher
plset LSUIElement bool true
# Иконка.
SRC="$DIR/tools/icon-src.png"
if [ -f "$SRC" ]; then
  ICONSET="$TMP/Systole.iconset"; mkdir -p "$ICONSET"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$SRC" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
    d=$((s*2)); sips -z $d $d "$SRC" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/applet.icns"
  # Иначе Finder возьмёт иконку апплета из Assets.car, а не наш icns.
  rm -f "$APP/Contents/Resources/Assets.car"; /usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$PL" >/dev/null 2>&1 || true
fi
codesign --force --deep -s - "$APP"
touch "$APP"
rm -rf "$TMP"
echo "$APP"
