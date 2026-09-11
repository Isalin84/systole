#!/bin/bash
# Запуск Systole: поднимает dev-сервер (если ещё не запущен) и открывает сцену в браузере.
# Из Finder PATH минимальный, поэтому добавляем Homebrew; при сбое показываем диалог.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$HOME/Library/Logs/systole.log"
PORT="${SYSTOLE_PORT:-8000}"
fail() { echo "$(date '+%F %T') $1" >>"$LOG"; osascript -e "display dialog \"$1\" with title \"Systole\" buttons {\"OK\"} default button 1 with icon stop" >/dev/null 2>&1; exit 1; }
cd "$DIR" || fail "Нет папки проекта: $DIR"
[ -f serve.py ] || fail "Нет serve.py в $DIR"
command -v python3 >/dev/null || fail "Не найден python3"
if ! lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  mkdir -p "$DIR/shots"
  nohup python3 serve.py $PORT --shots "$DIR/shots" >>"$LOG" 2>&1 &
  for i in $(seq 1 20); do lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && break; sleep 0.25; done
  lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 || fail "Сервер не поднялся. Лог: $LOG"
fi
echo "$(date '+%F %T') ok: открываю http://localhost:$PORT/" >>"$LOG"
open "http://localhost:$PORT/"
