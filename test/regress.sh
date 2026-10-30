// regress.sh —— 全量回归：在同一批命令内起服务 → 跑套件 → 关服务
// 用法：bash test/regress.sh [批次号]
// 批次划分用于规避单条命令 10 分钟上限；每批内的套件端口各异，逐个起停。
set -u
cd "$(dirname "$0")/.." || exit 1
BATCH="${1:-1}"
LOGDIR=".tmp/regress-b${BATCH}"
mkdir -p "$LOGDIR"

run_suite() {
  local file="$1" port="$2" name="$3"
  # v3.6：端口可用性预检 —— 本机可能有系统服务占用测试端口
  #       （实测 ZTEUsbIpSvc 常驻 3240），server.js 起不来时，
  #       套件会访问到错误页并报 chrome-error://chromewebdata 的模块加载失败，
  #       看起来像代码坏了，实则是端口冲突。
  if netstat -ano 2>/dev/null | grep -qE "0\.0\.0\.0:${port}[[:space:]]"; then
    echo "[$name] 跳过 —— 端口 ${port} 已被其它进程占用"
    return 1
  fi
  # 启动前清掉该端口上的僵尸 server（上次运行被中断时残留）
  local oldpid
  oldpid=$(netstat -ano 2>/dev/null | grep -E "0\.0\.0\.0:${port}[[:space:]]" | awk '{print $5}' | head -1)
  if [ -n "${oldpid:-}" ]; then
    taskkill //F //PID "$oldpid" >/dev/null 2>&1 || true
    sleep 1
  fi
  node server.js --port="$port" > "$LOGDIR/${name}-server.log" 2>&1 &
  local pid=$!
  sleep 2
  node "$file" > "$LOGDIR/${name}.log" 2>&1
  local code=$?
  kill $pid 2>/dev/null
  wait $pid 2>/dev/null
  local sum
  sum=$(grep -E '通过|汇总|PASS|FAIL' "$LOGDIR/${name}.log" | tail -1)
  echo "[$name] exit=$code — ${sum:0:110}"
  return $code
}

case "$BATCH" in
1)
  run_suite test/e2e.mjs 3210 e2e
  run_suite test/verify-fixes.mjs 3123 fixes
  run_suite test/verify-upgrade.mjs 3123 upgrade
  run_suite test/verify-v13.mjs 3244 v13
  ;;
2)
  run_suite test/verify-v14.mjs 3217 v14
  run_suite test/verify-v15.mjs 3218 v15
  run_suite test/verify-v16.mjs 3219 v16
  run_suite test/verify-v17.mjs 3221 v17
  ;;
3)
  run_suite test/verify-v18.mjs 3222 v18
  run_suite test/verify-v19.mjs 3223 v19
  run_suite test/verify-v20.mjs 3224 v20
  run_suite test/verify-v21.mjs 3225 v21
  ;;
4)
  run_suite test/verify-v22.mjs 3226 v22
  run_suite test/verify-v23.mjs 3227 v23
  run_suite test/verify-v24.mjs 3228 v24
  run_suite test/verify-v25.mjs 3229 v25
  ;;
5)
  run_suite test/verify-v26.mjs 3230 v26
  run_suite test/verify-v27.mjs 3231 v27
  run_suite test/verify-v28.mjs 3232 v28
  run_suite test/verify-v29.mjs 3233 v29
  ;;
6)
  run_suite test/verify-v30.mjs 3235 v30
  run_suite test/verify-growth.mjs 3245 growth
  run_suite test/verify-v31.mjs 3236 v31
  run_suite test/verify-v32.mjs 3237 v32
  run_suite test/verify-v33.mjs 3238 v33
  run_suite test/verify-v34.mjs 3239 v34
  run_suite test/verify-v35.mjs 3241 v35
  run_suite test/verify-v36.mjs 3242 v36
  ;;
*)
  echo "未知批次：$BATCH"; exit 2
  ;;
esac
