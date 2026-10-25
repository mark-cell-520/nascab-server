#!/usr/bin/env bash
# NasCabOS 服务端启动脚本（Linux/macOS 裸机部署）
# 用法：./deploy/scripts/start.sh [start|stop|restart|status]
set -euo pipefail

APP_DIR="${NASCAB_APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../electron_server" && pwd)}"
DATA_DIR="${NASCAB_DATA_DIR:-$APP_DIR/data}"
LOG_DIR="${NASCAB_LOG_DIR:-$APP_DIR/logs}"
RUN_DIR="${NASCAB_RUN_DIR:-$DATA_DIR}"
PID_FILE="$RUN_DIR/nascabos.pid"
NODE_BIN="${NODE_BIN:-node}"

mkdir -p "$DATA_DIR" "$LOG_DIR" "$RUN_DIR"

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

start() {
  if is_running; then
    echo "已在运行 (PID $(cat "$PID_FILE"))"
    return 0
  fi
  cd "$APP_DIR"

  # 部署配置：环境变量优先于 config.json
  export NODE_ENV="${NODE_ENV:-production}"
  export NASCAB_DATA_DIR="$DATA_DIR"
  export NASCAB_LOG_DIR="$LOG_DIR"
  export NASCAB_HOST="${NASCAB_HOST:-0.0.0.0}"
  export PORT="${PORT:-6789}"
  export HTTPS_PORT="${HTTPS_PORT:-6799}"
  export NASCAB_HTTPS_ENABLED="${NASCAB_HTTPS_ENABLED:-false}"
  export NASCAB_PORT_FALLBACK="${NASCAB_PORT_FALLBACK:-false}"
  export NASCAB_ACCESS_LOG="${NASCAB_ACCESS_LOG:-true}"
  export NASCAB_WORKER_AUTO_RESTART="${NASCAB_WORKER_AUTO_RESTART:-true}"

  echo "启动 NasCabOS ..."
  echo "  应用目录: $APP_DIR"
  echo "  数据目录: $DATA_DIR"
  echo "  日志目录: $LOG_DIR"
  nohup "$NODE_BIN" src/main_nascab_os.js >>"$LOG_DIR/stdout.log" 2>&1 &
  echo $! >"$PID_FILE"
  sleep 3
  if is_running; then
    echo "已启动 (PID $(cat "$PID_FILE"))"
  else
    echo "启动失败，请查看 $LOG_DIR/stdout.log"
    rm -f "$PID_FILE"
    return 1
  fi
}

stop() {
  if ! is_running; then
    echo "未在运行"
    rm -f "$PID_FILE"
    return 0
  fi
  local pid
  pid="$(cat "$PID_FILE")"
  echo "停止 NasCabOS (PID $pid) ..."
  # SIGTERM 触发优雅关停：先停 worker，再释放单例锁
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 60); do
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "优雅停止超时，强制结束"
    kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  echo "已停止"
}

status() {
  if is_running; then
    echo "运行中 (PID $(cat "$PID_FILE"))"
    curl -fsS "http://127.0.0.1:${PORT:-6789}/healthz" 2>/dev/null && echo "" || echo "（进程存活但 /healthz 未响应）"
    return 0
  fi
  echo "未运行"
  return 3
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  *) echo "用法: $0 {start|stop|restart|status}"; exit 1 ;;
esac
