#!/bin/zsh
# feed 网页常驻。由 launchd KeepAlive 守着。
#
# 端口 8166 是刻意选的：3000 是各类脚手架的默认口，同时开几个项目必撞。
# 单一来源在这里，其它脚本从这儿读（见 open-feed.command / scripts/afs）。
set -u
# 从脚本自身位置推出项目根，别写死路径——克隆到任何目录都能用
PROJECT="${0:A:h:h}"
# node 三级探测：launchd 的 shell 不加载 ~/.zshrc，nvm.sh 也可能不存在。
# 形式参考 kimi work/api-usage-board/serve.command——比只 source nvm.sh 稳。
NODE=$(command -v node 2>/dev/null || true)
if [[ -z "$NODE" && -s "$HOME/.nvm/nvm.sh" ]]; then
  source "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
  NODE=$(command -v node 2>/dev/null || true)
fi
if [[ -z "$NODE" ]]; then
  NODE=$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)
fi
[[ -n "$NODE" ]] && export PATH="$(dirname "$NODE"):$PATH"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
cd "$PROJECT" || exit 1

# ⚠️ 只启服务，不在这里做「源码变了就重建」。
#    这个进程被 launchd KeepAlive 守着，构建一旦被重启打断就永远完不成，
#    结果是「构建→被杀→重启→再构建」的循环。实测踩过。
#    改代码后用 `afs build` 显式重建——那是一次性动作，不该混进守护进程。
#
#    只有完全没有构建产物时才自动补一次（首次安装的便利），
#    且判据是 BUILD_ID 而不是 .next 目录——next dev 也会写 .next 但结构不同。
if [[ ! -f .next/BUILD_ID ]]; then
  echo "$(date '+%H:%M:%S') 没有生产构建，补建一次…"
  rm -rf .next
  npm run build || { echo "构建失败，请手工跑 npm run build 查看原因"; exit 0; }
fi

PORT="${AFS_PORT:-8166}"
NEXT_BIN="$PROJECT/node_modules/next/dist/bin/next"

# `next start` 会把启动时的构建清单留在内存里。若另一个终端直接执行
# `npm run build`，`.next` 会被新产物替换，而旧进程仍会向浏览器下发旧 chunk
# 地址，最终变成整页 ChunkLoadError。这里不负责构建，只在完整的新 BUILD_ID
# 出现后平滑重启 next 子进程，让直接 build 和 `afs build` 两条路径都能自愈。
SERVER_PID=""
stop_server() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap 'stop_server; exit 0' TERM INT HUP

while true; do
  START_BUILD_ID=$(<.next/BUILD_ID)
  echo "$(date '+%H:%M:%S') 启动 localhost:$PORT · build ${START_BUILD_ID[1,8]}"
  "$NODE" "$NEXT_BIN" start -p "$PORT" &
  SERVER_PID=$!
  BUILD_CHANGED=0

  while kill -0 "$SERVER_PID" 2>/dev/null; do
    sleep 2
    # 构建过程中 BUILD_ID 会短暂消失；只在新 ID 完整落盘后重启。
    if [[ -f .next/BUILD_ID ]]; then
      CURRENT_BUILD_ID=$(<.next/BUILD_ID)
      if [[ -n "$CURRENT_BUILD_ID" && "$CURRENT_BUILD_ID" != "$START_BUILD_ID" ]]; then
        echo "$(date '+%H:%M:%S') 检测到新构建 ${CURRENT_BUILD_ID[1,8]}，重启网页服务…"
        BUILD_CHANGED=1
        stop_server
        SERVER_PID=""
        break
      fi
    fi
  done

  if [[ "$BUILD_CHANGED" -eq 1 ]]; then
    continue
  fi

  wait "$SERVER_PID"
  exit $?
done
