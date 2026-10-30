// run-all.mjs —— 顺序跑完全部回归套件并汇总（服务器需已启动）
import { execFileSync } from 'node:child_process';
const suites = [
  ['e2e', 'test/e2e.mjs'],
  ['fixes', 'test/verify-fixes.mjs'],
  ['upgrade', 'test/verify-upgrade.mjs'],
  ['v13', 'test/verify-v13.mjs'],
  ['v14', 'test/verify-v14.mjs'],
  ['v15', 'test/verify-v15.mjs'],
  ['v16', 'test/verify-v16.mjs'],
  ['v17', 'test/verify-v17.mjs'],
  ['v18', 'test/verify-v18.mjs'],
  ['v19', 'test/verify-v19.mjs'],
  ['v20', 'test/verify-v20.mjs'],
  ['v21', 'test/verify-v21.mjs'],
  ['v22', 'test/verify-v22.mjs'],
  ['v23', 'test/verify-v23.mjs'],
  ['v24', 'test/verify-v24.mjs'],
  ['v25', 'test/verify-v25.mjs'],
  ['v26', 'test/verify-v26.mjs'],
  ['v27', 'test/verify-v27.mjs'],
  ['v28', 'test/verify-v28.mjs'],
  ['v29', 'test/verify-v29.mjs'],
  ['v30', 'test/verify-v30.mjs'],
  ['growth', 'test/verify-growth.mjs'],
  ['v31', 'test/verify-v31.mjs'],
  ['v32', 'test/verify-v32.mjs'],
  ['v33', 'test/verify-v33.mjs'],
  ['v34', 'test/verify-v34.mjs'],
];
const results = [];
for (const [name, file] of suites) {
  const t0 = Date.now();
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, [file], { encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    code = e.status || 1;
    out = (e.stdout || '') + (e.stderr || '');
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const sumLine = out.split('\n').filter((l) => /通过|汇总|PASS|FAIL/.test(l)).slice(-1)[0] || '(无汇总行)';
  const errs = (out.match(/CONSOLE-ERRORS: \[\]/g) || []).length ? 'zero-errors' : 'CHECK-ERRORS';
  results.push([name, code === 0 ? 'PASS' : 'FAIL', secs, errs, sumLine.trim().slice(0, 120)]);
  console.log(`[${name}] ${code === 0 ? 'PASS' : 'FAIL'} (${secs}s, ${errs}) — ${sumLine.trim().slice(0, 120)}`);
}
console.log('\n===== 全量回归汇总 =====');
for (const [n, r, s, e, l] of results) console.log(`${r === 'PASS' ? '✅' : '❌'} ${n} ${r} ${s}s ${e}`);
const fails = results.filter(([, r]) => r !== 'PASS').map(([n]) => n);
console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'ALL SUITES PASSED');
process.exit(fails.length ? 1 : 0);
