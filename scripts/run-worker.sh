#!/bin/zsh
# 每日 worker。由 launchd 在北京时间 06:00 调起。
#
# ⚠️ launchd 的 PATH 极简，且不会读 ~/.zshrc。这里显式解析 nvm，
#    而不是把 v24.19.0 这样的版本号写死在 plist 里——升级 node 就会断。
set -u
# 从脚本自身位置推出项目根，别写死路径——克隆到任何目录都能用
PROJECT="${0:A:h:h}"

# node 三级探测：launchd 的 shell 不加载 ~/.zshrc，nvm.sh 也可能不存在。
# 形式参考 kimi work/api-usage-board/serve.command——比只 source nvm.sh 稳。
# ⚠️ 每一级都要校验主版本，不能「找到就用」。
#    2026-09-05 实测：launchd 的 PATH 含 /usr/local/bin，那儿躺着一个独立的
#    node v22.14.0，`command -v node` 第一步就命中它，于是后面的 nvm 分支
#    根本不会执行 —— 日志里显示 node v22.14.0，而 engines 要求 >=24。
node_major() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null; }
node_ok()    { [[ -x "$1" ]] && [[ "$(node_major "$1")" -ge 24 ]] 2>/dev/null; }

NODE=""
# ① nvm 优先（Alice 日常 shell 用的就是这个，与 run-web.sh 同源）
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  source "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
  CAND=$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)
  node_ok "$CAND" && NODE="$CAND"
fi
# ② PATH 里的（必须过版本校验）
if [[ -z "$NODE" ]]; then
  CAND=$(command -v node 2>/dev/null || true)
  node_ok "$CAND" && NODE="$CAND"
fi
# ③ brew / 系统里的兜底（同样要过校验）
if [[ -z "$NODE" ]]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node; do
    node_ok "$c" && { NODE="$c"; break; }
  done
fi
if [[ -z "$NODE" ]]; then
  echo "❌ 找不到符合 engines 要求的 Node（需 >= 24）"
  echo "   提示：nvm install 24 && nvm alias default 24"
  exit 1
fi
# ⚠️ 顺序要紧：brew 路径先加，node 目录**最后**前置。
#    反过来写的话，上面 9 行三级探测就白做了——brew 自带的 node（v22.x）会盖掉
#    nvm 的 v24.19.0。2026-09-05 实测就是这样：日志显示 node v22.14.0，
#    而 nvm 里只装了 v24.19.0。同一天在 CI（node 22 vs 24）和 Homebrew 的
#    path_helper 上各踩过一次，是同一个形状：精心构造的 PATH 被后一行随手盖掉。
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH"
[[ -n "$NODE" ]] && export PATH="$(dirname "$NODE"):$PATH"

cd "$PROJECT" || { echo "找不到项目目录 $PROJECT"; exit 1; }


# Let’s Encrypt 的新 Root YR 尚未进入 Node 自带信任库。个别站点又漏发了
# YR-by-X1 交叉证书；只给 worker 补官方交叉链，绝不关闭 TLS 校验。
export NODE_EXTRA_CA_CERTS="$PROJECT/certs/letsencrypt-root-yr-by-x1.pem"

echo "───────── $(date '+%Y-%m-%d %H:%M:%S') 开始 ─────────"
command -v node >/dev/null || { echo "❌ 找不到 node"; exit 1; }
command -v yt-dlp >/dev/null || echo "⚠️ 找不到 yt-dlp，YouTube 字幕会取不到"
echo "node $(node -v) · yt-dlp $(yt-dlp --version 2>/dev/null || echo 无)"

npx tsx tools/worker.ts --max-jobs "${AFS_MAX_JOBS:-200}" --budget-min "${AFS_BUDGET_MIN:-25}"
# ⚠️ 变量名不能叫 status：launchd 用 `zsh -lc` 跑本脚本，而 zsh 里 $status 是
#    只读特殊变量（等价 $?），赋值会直接中断脚本 → 「结束」那行从不打印，
#    worker 的真实退出码被吞掉，job 恒报退出码 1。真失败和假失败会长得一模一样。
rc=$?
echo "───────── $(date '+%Y-%m-%d %H:%M:%S') 结束（退出码 $rc）─────────"
exit $rc
