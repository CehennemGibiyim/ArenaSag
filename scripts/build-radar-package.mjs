#!/usr/bin/env node
/**
 * Arena Radar Windows paketini hazırlar.
 *
 *   node scripts/build-radar-package.mjs --node-exe node.exe
 *
 * Çıktı: release/radar/  (NSIS bu klasörü kurulum paketine gömer)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STAGE = path.join(ROOT, "release", "radar");
const nodeArg = process.argv.indexOf("--node-exe");
const nodeExe = nodeArg >= 0 ? process.argv[nodeArg + 1] : "";

const version = JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8"));

function copy(source, target = source) {
  const from = path.join(ROOT, source);
  if (!fs.existsSync(from)) return;
  const to = path.join(STAGE, target);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, {
    recursive: true,
    filter: (entry) => {
      const name = path.basename(entry);
      return !["config.json", "radar.log", "radar.pid", "node_modules", "updates", "alerted.json"].includes(name);
    },
  });
}

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

copy("desktop");
copy("web");
copy("scripts/radar-publish.mjs");
copy("version.json");

const launcher = [
  "@echo off",
  "chcp 65001 >nul",
  "title Arena Radar",
  'cd /d "%~dp0"',
  'if exist "%~dp0node.exe" (set "NODE=%~dp0node.exe") else (set "NODE=node")',
  'if "%~1"=="--silent" (',
  '  start "" /min "%NODE%" "%~dp0desktop\\main.mjs" --silent',
  ") else (",
  '  start "" "%NODE%" "%~dp0desktop\\main.mjs"',
  ")",
  "",
].join("\r\n");

const stop = [
  "@echo off",
  "chcp 65001 >nul",
  "title Arena Radar - Durdur",
  'set "PIDFILE=%LOCALAPPDATA%\\ArenaRadar\\radar.pid"',
  'if exist "%PIDFILE%" (',
  '  set /p RADARPID=<"%PIDFILE%"',
  "  taskkill /F /PID %RADARPID% >nul 2>&1",
  '  del "%PIDFILE%" >nul 2>&1',
  "  echo Arena Radar durduruldu.",
  ") else (",
  "  echo Calisan Arena Radar kaydi bulunamadi.",
  ")",
  "timeout /t 2 >nul",
  "",
].join("\r\n");

fs.writeFileSync(path.join(STAGE, "ArenaRadar.bat"), launcher);
fs.writeFileSync(path.join(STAGE, "Durdur.bat"), stop);
fs.writeFileSync(
  path.join(STAGE, "SURUM.txt"),
  [
    `${version.name} ${version.version}`,
    `Paketlenme: ${new Date().toISOString()}`,
    "Veri kaynağı: GitHub Radar (web/data/arena-live.json)",
    "Panel: http://127.0.0.1:4817/panel/ (salt okunur web paneli)",
    "Kurulum: ArenaRadar-Setup.exe (yönetici gerekmez)",
    "Kaldırma: Ayarlar → Uygulamalar → Arena Radar",
    "",
  ].join("\r\n"),
);

if (nodeExe && fs.existsSync(nodeExe)) {
  fs.copyFileSync(nodeExe, path.join(STAGE, "node.exe"));
  console.log("Gömülü node.exe eklendi.");
} else {
  console.warn("UYARI: node.exe bulunamadı; paket sistemdeki Node.js'i kullanır.");
}

console.log(`Arena Radar ${version.version} paketi hazır: ${STAGE}`);
