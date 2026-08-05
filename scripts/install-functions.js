/**
 * 同步公共代码 + 安装各云函数 npm 依赖。
 *
 * 公共逻辑以「实体目录 ./common」拷进每个云函数（不用 node_modules 链接），
 * 避免 Windows junction / 云端安装依赖导致 Cannot find module。
 *
 * 用法：node scripts/install-functions.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const fnRoot = path.join(__dirname, '..', 'cloudfunctions');
const commonSrc = path.join(fnRoot, 'common');
const skip = new Set(['common']);

function rmrf(target) {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function syncCommon(fnDir) {
  const target = path.join(fnDir, 'common');
  rmrf(target);
  copyDir(commonSrc, target);
  // 清理旧的 node_modules/mp-common（若存在）
  rmrf(path.join(fnDir, 'node_modules', 'mp-common'));
  console.log(`  → 已同步 common/ 到 ${path.relative(fnRoot, target)}`);
}

fs.readdirSync(fnRoot).forEach((name) => {
  const dir = path.join(fnRoot, name);
  const pkg = path.join(dir, 'package.json');
  if (skip.has(name) || !fs.existsSync(pkg)) return;

  console.log(`\n=== sync + npm install: ${name} ===`);
  syncCommon(dir);
  execSync('npm install', { cwd: dir, stdio: 'inherit' });
});

console.log('\n完成。请对每个云函数选择：上传并部署 → 云端安装依赖（或所有文件）');
