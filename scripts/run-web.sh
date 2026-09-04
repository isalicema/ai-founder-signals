#!/bin/zsh
# feed 网页常驻。由 launchd KeepAlive 守着。
#
# 端口 8166 是刻意选的：3000 是各类脚手架的默认口，同时开几个项目必撞。
# 单一来源在这里，其它脚本从这儿读（见 open-feed.command / scripts/afs）。
set -u
# 从脚本自身位置推出项目根，别写死路径——克隆到任何目录都能用
PROJECT="${0:A:h:h}"
# engines 要求 Node >= 24（2026-09-05 从 ">=22 <23" 改过来）。
# ⚠️ 别改回 22：package-lock.json 由 npm 11 生成，而 node@22 自带的是 npm 10，
#    读不懂这份 lock —— `npm ci` 会报 "Missing: esbuild@0.28.2 from lock file"。
#    CI 在 2026-08-31 就是栽在这上面，查了很久才定位到是 npm 大版本差异。
# 版本校验（主版本 >= 24）保留星子的写法，只是把目标版本改对。
node_major() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null; }
node_ok()    { [[ -x "$1" ]] && [[ "$(node_major "$1")" -ge 24 ]] 2>/dev/null; }

NODE=""
# ① nvm 优先：与 run-worker.sh 同源，也是 Alice 日常 shell 用的那个
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  source "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
  NVM_NODE=$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)
  node_ok "$NVM_NODE" && NODE="$NVM_NODE"
fi
# ② PATH 里的
if [[ -z "$NODE" ]]; then
  CANDIDATE_NODE=$(command -v node 2>/dev/null || true)
  node_ok "$CANDIDATE_NODE" && NODE="$CANDIDATE_NODE"
fi
# ③ brew 的（注意 /opt/homebrew/bin/node 目前是 22.x，会被上面的校验挡掉，这是对的）
if [[ -z "$NODE" ]]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node; do
    node_ok "$c" && { NODE="$c"; break; }
  done
fi
if [[ -z "$NODE" ]]; then
  echo "找不到符合 engines 要求的 Node.js（需 >= 24）"
  echo "  提示：nvm install 24 && nvm alias default 24"
  exit 1
fi
export PATH="$(dirname "$NODE"):/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH"
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
