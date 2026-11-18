import { APP_VERSION, isNewerVersion } from "@/lib/app-version";

export type UpdateStatus = {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  assetUrl: string | null;
  assetName: string | null;
  checksumUrl: string | null;
  publishedAt: string | null;
  notes: string | null;
  checkedAt: string;
  cached: boolean;
  error: string | null;
};

const repo = () => process.env.ARENA_GITHUB_REPO || "CehennemGibiyim/Arena";
const cache = globalThis as typeof globalThis & { __arenaUpdateCache?: { at: number; value: UpdateStatus } };
const TTL_MS = 15 * 60 * 1000;

function base(): UpdateStatus {
  return {
    currentVersion: APP_VERSION,
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: null,
    assetUrl: null,
    assetName: null,
    checksumUrl: null,
    publishedAt: null,
    notes: null,
    checkedAt: new Date().toISOString(),
    cached: false,
    error: null,
  };
}

export async function getUpdateStatus(force = false): Promise<UpdateStatus> {
  const now = Date.now();
  const cached = cache.__arenaUpdateCache;
  if (!force && cached && now - cached.at < TTL_MS) {
    return { ...cached.value, cached: true, checkedAt: new Date(cached.at).toISOString() };
  }
  const status = base();
  try {
    const response = await fetch(`https://api.github.com/repos/${repo()}/releases/latest`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "ArenaLiveOS-Updater",
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (response.status === 404) {
      status.error = "Henüz GitHub Release yok. İlk v* tag'inden sonra güncelleme denetimi çalışır.";
      cache.__arenaUpdateCache = { at: now, value: status };
      return status;
    }
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    const data = (await response.json()) as {
      tag_name?: string;
      html_url?: string;
      published_at?: string;
      body?: string;
      assets?: Array<{ name?: string; browser_download_url?: string }>;
    };
    const latest = String(data.tag_name || "").replace(/^v/, "");
    const assets = Array.isArray(data.assets) ? data.assets : [];
    const zip = assets.find((a) => /Arena-Live-OS-windows\.zip$/i.test(a.name || "")) ?? assets.find((a) => /\.zip$/i.test(a.name || ""));
    const sums = assets.find((a) => /SHA256SUMS\.txt$/i.test(a.name || ""));
    status.latestVersion = latest || null;
    status.updateAvailable = latest ? isNewerVersion(latest, APP_VERSION) : false;
    status.releaseUrl = data.html_url || null;
    status.assetUrl = zip?.browser_download_url || null;
    status.assetName = zip?.name || null;
    status.checksumUrl = sums?.browser_download_url || null;
    status.publishedAt = data.published_at || null;
    status.notes = data.body ? data.body.slice(0, 4000) : null;
  } catch (error) {
    status.error = error instanceof Error ? error.message : "Güncelleme denetlenemedi";
  }
  cache.__arenaUpdateCache = { at: now, value: status };
  return status;
}
