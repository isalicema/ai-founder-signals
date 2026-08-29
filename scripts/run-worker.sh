#!/bin/zsh
# 每日 worker。由 launchd 在北京时间 06:00 调起。
#
# ⚠️ launchd 的 PATH 极简，且不会读 ~/.zshrc。这里显式解析 nvm，
#    而不是把 v24.19.0 这样的版本号写死在 plist 里——升级 node 就会断。
set -u
PROJECT="$HOME/Projects/ai-founder-signals"

[[ -s "$HOME/.nvm/nvm.sh" ]] && source "$HOME/.nvm/nvm.sh" --no-use && nvm use --silent default 2>/dev/null
# yt-dlp 在 /usr/local/bin，launchd 默认 PATH 里没有
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

cd "$PROJECT" || { echo "找不到项目目录 $PROJECT"; exit 1; }

echo "───────── $(date '+%Y-%m-%d %H:%M:%S') 开始 ─────────"
command -v node >/dev/null || { echo "❌ 找不到 node"; exit 1; }
command -v yt-dlp >/dev/null || echo "⚠️ 找不到 yt-dlp，YouTube 字幕会取不到"
echo "node $(node -v) · yt-dlp $(yt-dlp --version 2>/dev/null || echo 无)"

npx tsx tools/worker.ts --max-jobs "${AFS_MAX_JOBS:-200}" --budget-min "${AFS_BUDGET_MIN:-25}"
status=$?
echo "───────── $(date '+%Y-%m-%d %H:%M:%S') 结束（退出码 $status）─────────"
exit $status
