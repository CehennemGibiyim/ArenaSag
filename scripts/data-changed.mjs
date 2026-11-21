#!/usr/bin/env node
/**
 * Yayın kararı — radar verisi anlamlı biçimde değişti mi?
 *
 * Her tarama `generatedAt`, `scanSeconds` ve `stats` alanlarını tazelediği için
 * dosya bayt düzeyinde hep farklıdır. Bu betik anlık görüntüyü anlamlı alanlarına
 * indirgeyip karşılaştırır:
 *
 *   - Yeni/kalkan canlı oda (roomId + username kümesi)         → değişti
 *   - Yeni/kalkan sandık ya da sandığın jeton/kontenjan/açılışı → değişti
 *   - Üye defteri toplamı arttı/azaldı                          → değişti
 *   - Zarf şeması uyarısı veya bilinmeyen zarf tipi değişti     → değişti (şema raporu)
 *   - Yayındaki veri MAX_AGE_MS'den eski                       → değişti (tazelik)
 *
 * Yalnızca izleyici sayısı, sıralama, başlık veya zaman damgası değiştiyse
 * commit ve Pages deploy'u atlanır. Böylece günde yüzlerce gereksiz deploy
 * yerine yalnızca gerçek değişimler yayınlanır.
 *
 * Kullanım:
 *   node scripts/data-changed.mjs --prev web/data --next /tmp/staged
 *
 * Çıktı: stdout'a tek kelime (`true` / `false`), gerekçe stderr'e yazılır.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

/** Yayındaki veri bu yaştan eskiyse değişiklik olmasa da tazelenir. */
export const MAX_AGE_MS = 20 * 60_000;

const ROOMS = "arena-live.json";
const ROSTER = "roster.json";

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

const list = (value) => (Array.isArray(value) ? value : []);
const obj = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const str = (value) => (typeof value === "string" ? value : "");

/** Canlı odaların kimlik kümesi (sıra ve izleyici sayısından bağımsız). */
export function roomKeys(snapshot) {
  return new Set(
    list(obj(snapshot).streams)
      .map((row) => `${str(obj(row).roomId)}:${str(obj(row).username)}`)
      .filter((key) => key !== ":"),
  );
}

/** Sandık kümesi — açılış zamanı ve ödül değişimi de anlamlı sayılır. */
export function chestKeys(snapshot) {
  return new Set(
    list(obj(snapshot).chests)
      .map((row) =>
        [str(obj(row).envelopeId), Number(obj(row).coins) || 0, Number(obj(row).slots) || 0, str(obj(row).opensAt)].join(":"),
      )
      .filter((key) => key && !key.startsWith(":")),
  );
}

export function sameSet(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

/**
 * Yayınlanacak zarf şeması imzası. Şema sürüklenmesi ve 24 saat sessizlik
 * uyarıları yalnızca `warnings`/`health` alanlarında görünür; oda ve sandık
 * kümeleri değişmese de panel bu raporu almalı. Kota sayaçları gibi her turda
 * değişen satırlar imzaya girmez, yoksa yayın kapısı her koşuda açılırdı.
 */
export function warningSignature(snapshot) {
  const data = obj(snapshot);
  const health = obj(data.health);
  const schemaWarnings = list(data.warnings)
    .map((line) => str(line))
    .filter((line) => line.startsWith("Zarf şeması sürüklenmesi:") || line.startsWith("24 saattir "));
  const unknownTypes = list(health.unknownEnvelopeTypes).map((type) => str(type));
  return [...schemaWarnings, ...unknownTypes].join("\n");
}

export function rosterTotal(payload) {
  const data = obj(payload);
  const total = Number(data.total);
  if (Number.isFinite(total)) return total;
  return list(data.streamers).length;
}

/**
 * @param {{prevArena: unknown, nextArena: unknown, prevRoster: unknown, nextRoster: unknown, now?: number}} input
 * @returns {{changed: boolean, reason: string}}
 */
export function decideChange({ prevArena, nextArena, prevRoster, nextRoster, now = Date.now() }) {
  if (!prevArena || !prevRoster) return { changed: true, reason: "ilk-yayin" };
  const generated = Date.parse(str(obj(prevArena).generatedAt));
  if (!Number.isFinite(generated)) return { changed: true, reason: "zaman-damgasi-yok" };
  if (now - generated >= MAX_AGE_MS) return { changed: true, reason: "veri-bayat" };
  if (!sameSet(roomKeys(prevArena), roomKeys(nextArena))) return { changed: true, reason: "oda-degisti" };
  if (!sameSet(chestKeys(prevArena), chestKeys(nextArena))) return { changed: true, reason: "sandik-degisti" };
  if (rosterTotal(prevRoster) !== rosterTotal(nextRoster)) return { changed: true, reason: "uye-defteri-buyudu" };
  if (warningSignature(prevArena) !== warningSignature(nextArena)) {
    return { changed: true, reason: "uyari-degisti" };
  }
  return { changed: false, reason: "anlamli-degisiklik-yok" };
}

async function main(argv) {
  const arg = (name, fallback) => {
    const index = argv.indexOf(name);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };
  const prev = arg("--prev", "web/data");
  const next = arg("--next", "");
  if (!next) throw new Error("--next klasörü gerekli");
  const [prevArena, nextArena, prevRoster, nextRoster] = await Promise.all([
    readJson(path.join(prev, ROOMS)),
    readJson(path.join(next, ROOMS)),
    readJson(path.join(prev, ROSTER)),
    readJson(path.join(next, ROSTER)),
  ]);
  if (!nextArena || !nextRoster) throw new Error("Yeni anlık görüntü okunamadı");
  const result = decideChange({ prevArena, nextArena, prevRoster, nextRoster });
  process.stderr.write(`[data-changed] ${result.changed ? "yayınla" : "atla"}: ${result.reason}\n`);
  process.stdout.write(`${result.changed}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`[data-changed] hata: ${error instanceof Error ? error.message : "bilinmeyen"}\n`);
    // Karar verilemiyorsa güvenli taraf: yayınla.
    process.stdout.write("true\n");
  });
}
