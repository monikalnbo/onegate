#!/usr/bin/env bash
# 发布前敏感信息扫描。用法：
#   bash tools/scan-secrets.sh            # 扫描当前仓库（跳过 .git/node_modules/data）
#   bash tools/scan-secrets.sh --all      # 连被忽略的文件一起扫（提交前自查用）
# 退出码：0 = 无命中；1 = 有命中；2 = 脚本自身环境问题。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2
EXCLUDE_DIRS='--exclude-dir=.git --exclude-dir=node_modules --exclude-dir=data --exclude-dir=evidence --exclude-dir=backup'
if [[ "${1:-}" == "--all" ]]; then EXCLUDE_DIRS='--exclude-dir=.git'; fi

# 允许出现的占位符（命中这些片段的行不再报错）
PLACEHOLDERS='example\.com|example\.org|your-|YOUR_|sk-mock-upstream|sk-your-|<[^>]+>|\$\{|\$[A-Z_]+|placeholder|PLACEHOLDER|xxx+|…|\.\.\.'

hits=0
report() {
  local title="$1"; local pattern="$2"; local extra="${3:-}"
  local out
  # shellcheck disable=SC2086
  out=$(grep -rInE $EXCLUDE_DIRS $extra -- "$pattern" . 2>/dev/null \
        | grep -vE "tools/scan-secrets\.sh" \
        | grep -vE "$PLACEHOLDERS")
  if [[ -n "$out" ]]; then
    printf '\n[命中] %s\n%s\n' "$title" "$out"
    hits=$((hits + $(printf '%s\n' "$out" | wc -l)))
  else
    printf '[通过] %s\n' "$title"
  fi
}

echo "扫描目录：$ROOT"
echo "规则：真实域名 / 公网 IP / 真实密钥 / 口令赋值 / 邮箱 / 私钥头 / 敏感文件类型"
echo

# 1. 自定义黑名单：把「本项目来源环境」的真实域名/主机名写进 .scan-denylist（每行一个正则，已被 git 忽略），
#    或通过 SCAN_DENYLIST='域名A|主机名B' 传入。仓库本身不包含任何真实域名。
if [[ -n "${SCAN_DENYLIST:-}" ]]; then
  report "自定义黑名单（环境变量）" "$SCAN_DENYLIST"
elif [[ -f .scan-denylist ]]; then
  denylist=$(grep -vE '^\s*(#|$)' .scan-denylist | paste -sd'|' -)
  report "自定义黑名单（.scan-denylist）" "$denylist"
else
  printf '[跳过] 自定义黑名单（未提供 SCAN_DENYLIST 或 .scan-denylist）\n'
fi
# 2. 真实公网 IP（排除私有网段与回环、文档保留网段）
ip_out=$(grep -rInoE $EXCLUDE_DIRS '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' . 2>/dev/null \
  | grep -vE 'tools/scan-secrets\.sh' \
  | grep -vE '127\.0\.0\.1|0\.0\.0\.0|255\.255\.255|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.' || true)
if [[ -n "$ip_out" ]]; then printf '\n[命中] 非私有 IPv4 地址\n%s\n' "$ip_out"; hits=$((hits + $(printf '%s\n' "$ip_out" | wc -l))); else printf '[通过] 非私有 IPv4 地址\n'; fi
# 3. 真实形态的密钥（sk- 开头且长度像真 key；演示占位符在上面白名单里）
report "疑似真实 API Key（sk- 长串）" 'sk-[A-Za-z0-9_-]{24,}'
report "OpenAI/Anthropic/其他常见前缀密钥" '(sk-proj-|sk-ant-|sk-or-v1-|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|xox[baprs]-)'
# 4. 口令/密钥赋值
report "口令/密钥被直接赋值" '(password|passwd|secret|token|api[_-]?key|admin[_-]?key)[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"']{6,}["'"'"']' '-i'
# 5. 邮箱（只允许 example.com/example.org 域名）
mail_out=$(grep -rInoE $EXCLUDE_DIRS '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' . 2>/dev/null \
  | grep -vE 'tools/scan-secrets\.sh' | grep -vE '@example\.(com|org)|@localhost|noreply@|@sentry|users\.noreply\.github\.com' || true)
if [[ -n "$mail_out" ]]; then printf '\n[命中] 真实邮箱地址\n%s\n' "$mail_out"; hits=$((hits + $(printf '%s\n' "$mail_out" | wc -l))); else printf '[通过] 真实邮箱地址\n'; fi
# 6. 私钥 / 证书内容
report "私钥头" 'BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY'
# 7. 敏感文件名（不应出现在仓库）
files=$(find . -path ./.git -prune -o -path ./node_modules -prune -o -type f \
  \( -name '*.key' -o -name '*.pem' -o -name '*.p12' -o -name '*.db' -o -name '*.sqlite*' -o -name '.env' -o -name '*.log' \) -print 2>/dev/null)
if [[ -n "$files" ]]; then printf '\n[命中] 敏感文件\n%s\n' "$files"; hits=$((hits + $(printf '%s\n' "$files" | wc -l))); else printf '[通过] 敏感文件\n'; fi
# 8. 数据库连接串
report "数据库连接串含口令" '[a-z]+://[^/@[:space:]]+:[^/@[:space:]]+@'
# 9. 生产绝对路径 / 运维痕迹
report "生产路径或运维痕迹" '(/opt/(relay|onegate-relay)/|/etc/letsencrypt/live|root@[0-9]|ssh -i|known_hosts)'

echo
if [[ $hits -eq 0 ]]; then
  echo "结果：0 命中，可以发布。"
  exit 0
else
  echo "结果：$hits 处命中，请先处理后再发布。"
  exit 1
fi
