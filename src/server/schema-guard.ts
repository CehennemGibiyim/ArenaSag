import { sql } from "drizzle-orm";
import { db } from "@/db";
import { activityLog } from "@/db/schema";

/**
 * Şema koruması — panelin beklediği tablo/kolonlar var mı?
 *
 * Migration uygulanmamış bir veritabanında panel 500 verip nedenini saklıyordu.
 * Açılışta tek bir `information_schema` sorgusuyla eksikleri tespit eder,
 * konsola ve aktivite akışına yazar. Süreci durdurmaz: panel kısmi çalışmaya
 * devam eder, sorun görünür olur.
 */

const REQUIRED: Record<string, string[]> = {
  live_rooms: ["username", "room_id", "verified_at", "live_now", "source"],
  chests: ["envelope_id", "coins", "slots", "opens_at", "status"],
  listener_jobs: ["room_id", "lease_until", "status"],
  radar_scans: ["report", "finished_at"],
  settings: ["id", "data"],
};

const state = globalThis as typeof globalThis & { __arenaSchemaChecked?: string[] };

export async function checkSchema(): Promise<string[]> {
  if (state.__arenaSchemaChecked) return state.__arenaSchemaChecked;
  const problems: string[] = [];
  try {
    const result = (await db.execute(
      sql`select table_name, column_name from information_schema.columns where table_schema = 'public'`,
    )) as unknown as { rows?: Array<{ table_name: string; column_name: string }> };
    const columns = new Map<string, Set<string>>();
    for (const row of result.rows ?? []) {
      const set = columns.get(row.table_name) ?? new Set<string>();
      set.add(row.column_name);
      columns.set(row.table_name, set);
    }
    if (columns.size === 0) {
      problems.push("public şeması boş; migration uygulanmamış olabilir (npm run db:migrate).");
    }
    for (const [table, needed] of Object.entries(REQUIRED)) {
      if (!needed.length) continue;
      const present = columns.get(table);
      if (!present) {
        problems.push(`${table} tablosu yok.`);
        continue;
      }
      for (const column of needed) {
        if (!present.has(column)) problems.push(`${table}.${column} kolonu yok.`);
      }
    }
    if (problems.length) {
      console.warn(`[arena] şema eksik: ${problems.join(" ")}`);
      await db
        .insert(activityLog)
        .values({
          kind: "warning",
          message: `Veritabanı şeması eksik: ${problems.slice(0, 4).join(" ")}`,
          meta: { problems },
        })
        .catch(() => null);
    }
  } catch (error) {
    // Bağlantı yoksa (build, ilk kurulum) sessiz kal; gerçek hata kullanımda görünür.
    console.warn(`[arena] şema kontrolü atlandı: ${(error as Error).message}`);
  }
  state.__arenaSchemaChecked = problems;
  return problems;
}
