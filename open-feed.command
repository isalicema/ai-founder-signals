#!/bin/bash
# open-feed.command —— 双击（或做成快捷指令）打开 AI Founder Signals。
#
# 做三件事，缺一不可：
#   1. 确保网页服务在跑（launchd 常驻，但意外挂了这里会拉起）
#   2. 等到真的能响应再开浏览器（冷启动约 30 秒，早开会看到报错页）
#   3. 如果今天还没抓过，后台补跑一次 worker——Mac 昨晚关机时 06:00 那趟就错过了
#
# 形式参考 kimi work/api-usage-board/serve.command。
#
# 做成快捷指令时用这一行（nohup + & 不可省，否则快捷指令会干等健康检查）：
#   nohup "/Users/yangwutu/Projects/ai-founder-signals/open-feed.command" \
#     >> "/Users/yangwutu/Library/Logs/afs-open.log" 2>&1 &
cd "$(dirname "$0")" || exit 1
PORT="${AFS_PORT:-8166}"
GUI="gui/$(id -u)"
WEB=com.machiwhale.afs.web
WORKER=com.machiwhale.afs.worker

# ── node 探测：双击 .command 的 shell 不加载 nvm，三级回退 ──
NODE=$(command -v node 2>/dev/null || true)
if [ -z "$NODE" ] && [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
  NODE=$(command -v node 2>/dev/null || true)
fi
if [ -z "$NODE" ]; then
  NODE=$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)
fi
[ -n "$NODE" ] && export PATH="$(dirname "$NODE"):/usr/local/bin:/opt/homebrew/bin:$PATH"

# ⚠️ --noproxy 不可省：Alice 开着 Clash 时环境里有 HTTP_PROXY=127.0.0.1:7897，
#    curl 会把对 localhost 的健康检查也走代理，结果永远探测失败——
#    服务明明是好的。实测踩过，当时误判成「启动慢」查了很久。
# ⚠️ --noproxy 不可省：Alice 开着 Clash 时环境里有 HTTP_PROXY=127.0.0.1:7897，
#    curl 会把对 localhost 的健康检查也走代理，结果永远探测失败——
#    服务明明是好的。实测踩过，当时误判成「启动慢」查了很久。
#
# 两级探测，对应两件不同的事：
#   accepting  端口已接受连接 → 可以开浏览器了，页面自己会显示加载骨架
#   alive      页面真的能返回 → 只用来判断「是不是彻底起不来」
accepting() { /usr/bin/nc -z -G 2 127.0.0.1 "$PORT" >/dev/null 2>&1; }
alive()     { /usr/bin/curl -sf -m 5 --noproxy '*' -o /dev/null "http://127.0.0.1:$PORT"; }

# ── 1. 确保服务在跑 ──
if ! accepting; then
  echo "网页服务未响应，拉起中…"
  launchctl bootstrap "$GUI" "$HOME/Library/LaunchAgents/$WEB.plist" 2>/dev/null \
    || launchctl kickstart -k "$GUI/$WEB" 2>/dev/null
fi

# ── 2. 端口一能接受连接就开浏览器 ──
#
# 不等数据就绪。页面有 loading.tsx，外壳会立刻渲染并显示「正在读取今天的信号」，
# 数据随后流进来。原先等到 HTTP 200 才 open，用户看到的是「点了快捷指令
# 什么都没发生」，等几十秒才弹窗——那比先弹一个加载中的页面糟得多。
for i in $(seq 1 90); do
  accepting && break
  [ $((i % 10)) -eq 0 ] && echo "  等待端口… ${i}s"
  sleep 1
done

if ! accepting; then
  echo ""
  echo "❌ 90 秒内端口都没起来。看日志：tail -30 ~/Library/Logs/afs-web.log"
  echo "   常见原因：没有生产构建 → 跑 afs build"
  # ⚠️ 只在真有终端时才等按键。做成快捷指令 / nohup 运行时没有 TTY，
  #    无条件 read 会永远挂着——那种卡死最难查，因为看不到任何输出。
  if [ -t 0 ]; then
    echo "按任意键退出。"
    read -n 1
  fi
  exit 1
fi

# ── 3. 立刻开浏览器 ──
open "http://localhost:$PORT"
echo "✅ 已打开 http://localhost:$PORT"

# ── 4. 今天还没抓过就后台补一趟（Mac 昨晚关机会错过 06:00）──
#      放在 open 之后：抓取要几分钟，不该让浏览器等它。
if [ -n "$NODE" ] && [ -f .env.local ]; then
  TODAY=$(date +%Y-%m-%d)
  if ! grep -q "^───────── $TODAY" "$HOME/Library/Logs/afs-worker.log" 2>/dev/null; then
    echo "今天还没抓过，后台补跑一次（几分钟，抓完刷新页面即可）"
    nohup ./scripts/run-worker.sh >> "$HOME/Library/Logs/afs-worker.log" 2>&1 &
  fi
fi
