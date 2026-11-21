/**
 * Sunucu açılışında başlatılan arka plan döngüleri.
 *
 * Her döngü kendi try/catch'inde: biri patlarsa diğerleri ve panel çalışmaya
 * devam eder. Build sırasında (DATABASE_URL yokken) hiçbiri başlatılmaz.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  try {
    const { checkSchema } = await import("@/server/schema-guard");
    await checkSchema();
  } catch {
    /* şema kontrolü bilgilendirme amaçlı */
  }

  try {
    const { startScannerLoop } = await import("@/server/scanner");
    startScannerLoop();
  } catch {
    /* tarayıcı ilk API çağrısında başlar */
  }
  try {
    const { startRosterLoop } = await import("@/server/roster-sync");
    startRosterLoop();
  } catch {
    /* üye defteri ilk API çağrısında aktarılır */
  }
  try {
    const { startRadarSyncLoop } = await import("@/server/radar-sync");
    startRadarSyncLoop();
  } catch {
    /* radar köprüsü ilk API çağrısında çalışır */
  }
  try {
    const { startRetentionLoop } = await import("@/server/retention");
    startRetentionLoop();
  } catch {
    /* saklama işi bir sonraki açılışta denenir */
  }
}
