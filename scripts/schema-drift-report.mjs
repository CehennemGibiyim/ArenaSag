#!/usr/bin/env node
/**
 * Bilinmeyen zarf tiplerinden GitHub issue gövdesi üretir.
 *
 * Maskeli ham kare `envelope-shard-*.json` artifact'ında kalır; issue'ya yalnızca
 * tip ve alan yolları yazılır. Böylece şema sürüklenmesi kişisel veri taşımadan
 * düzeltilebilir.
 *
 * Kullanım:
 *   node scripts/schema-drift-report.mjs [arena-live.json]
 */
import { readFile } from "node:fs/promises";

const text = (value, max = 120) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const code = (value) => `\`${text(value).replaceAll("`", "'")}\``;

/** @returns {string} boş dize = bilinmeyen zarf örneği yok */
export function schemaDriftReport(data, { runUrl = "" } = {}) {
  const rows = Array.isArray(data?.health?.unknownEnvelopeSamples)
    ? data.health.unknownEnvelopeSamples.filter((row) => row && row.type)
    : [];
  if (!rows.length) return "";
  const lines = [
    "Radar bilinmeyen bir zarf/çanta tipi gördü; dönüştürücü güncellenmeli.",
    "",
  ];
  if (runUrl) lines.push(`Koşu: ${runUrl}`, "");
  for (const row of rows) {
    lines.push(`- ${code(row.type)}`);
    const fields = Array.isArray(row.fields) ? row.fields.filter(Boolean).slice(0, 20) : [];
    if (fields.length) lines.push(`  Alanlar: ${fields.map(code).join(", ")}`);
  }
  lines.push(
    "",
    "Maskeli ham kare koşu artifact'larındaki `envelope-shard-*.json` içinde `watch.unknownSamples` altında.",
    "Düzeltme: `scripts/envelope-watch.mjs` içindeki `ENVELOPE_MESSAGE_TYPES` listesine tipi ekleyip dönüştürücüyü güncelleyin.",
  );
  return `${lines.join("\n")}\n`;
}

async function main() {
  const file = process.argv[2] || "web/data/arena-live.json";
  const data = JSON.parse(await readFile(file, "utf8"));
  const runUrl =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : "";
  process.stdout.write(schemaDriftReport(data, { runUrl }));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    process.stderr.write(`[schema-drift] ${error instanceof Error ? error.message : "hata"}\n`);
    process.exit(1);
  });
}
