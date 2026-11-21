#!/usr/bin/env node
/**
 * Arena Radar veri sözleşmesi.
 *
 * `arena-live.json` ve `roster.json` iki ayrı tüketici tarafından okunur:
 * GitHub Pages/web kütüphanesi ve Windows Radar uygulaması. Alan adları
 * sessizce değişirse istemciler bozulur; bu modül yayın öncesi doğrulama ve
 * sözleşme testi için tek kaynaktır. `schema` alanı 1'den büyütülürse
 * tüketiciler de aynı anda güncellenmelidir.
 *
 * Kullanım:
 *   node scripts/radar-contract.mjs web/data/arena-live.json
 */
import { readFile } from "node:fs/promises";

const MAX_PROBLEMS = 25;
const isObj = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isStr = (value, allowEmpty = false) => typeof value === "string" && (allowEmpty || value.length > 0);
const isNum = (value) => typeof value === "number" && Number.isFinite(value);

function push(problems, message) {
  if (problems.length < MAX_PROBLEMS) problems.push(message);
}

/** @returns {string[]} boş dizi = geçerli */
export function validateSnapshot(data) {
  const problems = [];
  if (!isObj(data)) return ["anlık görüntü bir nesne değil"];
  if (data.schema !== 1) push(problems, "schema 1 olmalı");
  if (!isStr(data.generatedAt) || !Number.isFinite(Date.parse(data.generatedAt))) push(problems, "generatedAt geçersiz");
  if (!isObj(data.stats)) push(problems, "stats nesne olmalı");
  if (!Array.isArray(data.streams)) push(problems, "streams dizi olmalı");
  if (!Array.isArray(data.chests)) push(problems, "chests dizi olmalı");
  if (data.errors !== undefined && !Array.isArray(data.errors)) push(problems, "errors dizi olmalı");

  for (const [index, row] of (Array.isArray(data.streams) ? data.streams : []).entries()) {
    if (!isObj(row)) {
      push(problems, `streams[${index}] nesne değil`);
      continue;
    }
    if (!isStr(row.username)) push(problems, `streams[${index}].username eksik`);
    if (!isStr(row.roomId)) push(problems, `streams[${index}].roomId eksik`);
    if (!isNum(Number(row.viewers))) push(problems, `streams[${index}].viewers sayı olmalı`);
  }

  for (const [index, row] of (Array.isArray(data.chests) ? data.chests : []).entries()) {
    if (!isObj(row)) {
      push(problems, `chests[${index}] nesne değil`);
      continue;
    }
    if (!isStr(row.envelopeId)) push(problems, `chests[${index}].envelopeId eksik`);
    if (!isStr(row.username)) push(problems, `chests[${index}].username eksik`);
    if (!isNum(Number(row.coins))) push(problems, `chests[${index}].coins sayı olmalı`);
    if (!isStr(row.opensAt) || !Number.isFinite(Date.parse(row.opensAt))) {
      push(problems, `chests[${index}].opensAt geçersiz`);
    }
  }
  return problems;
}

/** @returns {string[]} boş dizi = geçerli */
export function validateRoster(data) {
  const problems = [];
  if (!isObj(data)) return ["üye defteri bir nesne değil"];
  if (data.schema !== 1) push(problems, "schema 1 olmalı");
  if (!isStr(data.updatedAt) || !Number.isFinite(Date.parse(data.updatedAt))) push(problems, "updatedAt geçersiz");
  if (!isNum(Number(data.total))) push(problems, "total sayı olmalı");
  if (!Array.isArray(data.streamers)) push(problems, "streamers dizi olmalı");
  if (!Array.isArray(data.days)) push(problems, "days dizi olmalı");
  for (const [index, row] of (Array.isArray(data.days) ? data.days : []).entries()) {
    if (!isObj(row) || !isStr(row.date)) push(problems, `days[${index}] geçersiz`);
  }
  for (const [index, row] of (Array.isArray(data.streamers) ? data.streamers : []).entries()) {
    if (!isObj(row) || !isStr(row.username)) push(problems, `streamers[${index}].username eksik`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const file = process.argv[2];
  if (!file) {
    console.error("Kullanım: node scripts/radar-contract.mjs <json dosyası>");
    process.exit(2);
  }
  const data = JSON.parse(await readFile(file, "utf8"));
  const problems = file.includes("roster") ? validateRoster(data) : validateSnapshot(data);
  if (problems.length) {
    console.error(`[radar-contract] ${file}: ${problems.length} sorun`);
    for (const problem of problems) console.error(` - ${problem}`);
    process.exit(1);
  }
  console.log(`[radar-contract] ${file}: geçerli`);
}
