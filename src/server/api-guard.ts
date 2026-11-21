import { getSettings } from "@/server/settings";

/**
 * Panel API koruması.
 *
 * - Token tanımlıysa (`ARENA_INGEST_TOKEN` veya panel ayarları) her istek token ister.
 * - Token yoksa yalnızca yerel (loopback) isteklere izin verilir; böylece kurulum
 *   varsayılan olarak açık bir yazma ucu bırakmaz. LAN üzerinden panele erişen
 *   kurulumlar tek bir token tanımlamalıdır.
 * - Mutasyonlarda tarayıcı kaynaklı istekler aynı kökenden gelmelidir (CSRF).
 */

function hostOf(request: Request): string {
  try {
    return new URL(request.url).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return "";
  }
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0"]);
const LOCAL_ADDRESSES = new Set(["127.0.0.1", "localhost", "::1", "::ffff:127.0.0.1"]);

/**
 * Proxy arkasında `Host` başlığı istemci tarafından yazılabilir. Yalnızca Host'a
 * bakmak, dışarıya açık bir kurulumda `Host: localhost` göndererek yetki
 * kontrolünü atlatmaya izin veriyordu. İletim başlıkları yerel değilse istek
 * yerel sayılmaz; uzak kurulumlar `ARENA_INGEST_TOKEN` tanımlamalıdır.
 */
export function isLoopback(request: Request): boolean {
  if (!LOCAL_HOSTS.has(hostOf(request))) return false;
  const forwarded = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().toLowerCase();
  if (forwarded && !LOCAL_ADDRESSES.has(forwarded)) return false;
  const realIp = (request.headers.get("x-real-ip") ?? "").trim().toLowerCase();
  if (realIp && !LOCAL_ADDRESSES.has(realIp)) return false;
  return true;
}

/** Origin yoksa (sunucu/servis çağrısı) aynı köken sayılır. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function adminToken(): Promise<string> {
  try {
    const settings = await getSettings();
    return process.env.ARENA_INGEST_TOKEN || (settings as unknown as { ingestToken?: string }).ingestToken || "";
  } catch {
    return process.env.ARENA_INGEST_TOKEN || "";
  }
}

function tokenFrom(request: Request): string {
  return (
    request.headers.get("x-arena-token") ??
    new URL(request.url).searchParams.get("token") ??
    (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
  );
}

/** Geçilirse null, aksi halde döndürülecek hata yanıtı. */
export async function guardAdmin(
  request: Request,
  options: { mutation?: boolean } = {},
): Promise<Response | null> {
  const expected = await adminToken();
  if (expected) {
    if (tokenFrom(request) === expected) return null;
    return Response.json(
      { ok: false, error: "Yetkisiz: x-arena-token (veya ?token=) gerekli." },
      { status: 401 },
    );
  }
  if (!isLoopback(request)) {
    return Response.json(
      {
        ok: false,
        error:
          "Bu uç yalnızca yerel ağdan veya token ile çağrılabilir. Uzak erişim için ARENA_INGEST_TOKEN tanımlayın.",
      },
      { status: 403 },
    );
  }
  if (options.mutation && !isSameOrigin(request)) {
    return Response.json({ ok: false, error: "Yetkisiz köken." }, { status: 403 });
  }
  return null;
}
