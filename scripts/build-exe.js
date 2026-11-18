const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "release", "Arena-Live-OS");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const copy = (from, to = from) => {
  const src = path.join(root, from);
  const dst = path.join(out, to);
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dst, { recursive: true, filter: (s) => !s.includes(`${path.sep}.git${path.sep}`) && !s.endsWith(".log") });
};

["src", "public", "scripts", "docs", "web", ".github", "agent"].forEach((d) => copy(d));
["package.json", "package-lock.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs", "eslint.config.mjs", "drizzle.config.json", ".env.example", "KURULUM.bat", "Arena-Live-OS.bat", "Arena-Update.bat", "Durdur.bat", "README.md", "version.json"].forEach((f) => copy(f));
copy(".next");
if (process.env.ARENA_PORTABLE_NODE === "1") {
  const node = process.execPath;
  fs.copyFileSync(node, path.join(out, "node.exe"));
}
const launcher = `@echo off\r\nchcp 65001 >nul\r\ntitle Arena Live OS\r\ncd /d "%~dp0"\r\nif exist node.exe (set "NODE=node.exe") else (set "NODE=node")\r\nif not exist node_modules call npm ci\r\nif not exist .next call npm run build\r\nstart "" http://localhost:3000\r\n%NODE% node_modules/next/dist/bin/next start\r\npause\r\n`;
fs.writeFileSync(path.join(out, "Arena-Live-OS.bat"), launcher);
fs.writeFileSync(path.join(out, "Durdur.bat"), "@echo off\r\nfor /f \"tokens=5\" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do taskkill /F /PID %%a\r\n");
console.log(`Portable paket hazır: ${out}`);
