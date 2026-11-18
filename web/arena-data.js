/**
 * Arena Radar veri katmanı — GitHub Pages / Windows Radar ortak kullanım.
 *
 * Öncelik sırası:
 *   1. Aynı origin'deki data/arena-live.json (GitHub Pages)
 *   2. raw.githubusercontent.com üzerindeki güncel kopya (hızlı tazeleme)
 *   3. ?data=... veya localStorage("arenaData") ile özel adres
 *   4. ?panel=... verilirse Arena panel API'si
 *
 * Bağımlılık yoktur; tarayıcıda global `ArenaData` olarak yüklenir.
 */
(function (global) {
  "use strict";

  var REPO = "CehennemGibiyim/ArenaSag";
  var RAW = "https://raw.githubusercontent.com/" + REPO + "/main/web/data/arena-live.json";
  var RELEASES = "https://github.com/" + REPO + "/releases/latest";
  var INSTALLER = RELEASES + "/download/ArenaRadar-Setup.exe";

  var TABS = [
    { id: "chest", label: "Sandık", filter: { kind: "chest" } },
    { id: "ratio1", label: "Oran ≥ 1", filter: { kind: "chest", minRatio: 1 } },
    { id: "ratio2", label: "Oran ≥ 2", filter: { kind: "chest", minRatio: 2 } },
    { id: "ratio4", label: "Oran ≥ 4", filter: { kind: "chest", minRatio: 4 } },
    { id: "kismet", label: "Kısmet ≥ 7", filter: { kind: "chest", minRatio: 7 } },
    { id: "s2016", label: "20/16", filter: { kind: "chest", minCoins: 20, maxSlots: 16 } },
    { id: "gold", label: "Altın", filter: { kind: "chest", variants: ["gold"] } },
    { id: "hanging", label: "Askıda", filter: { kind: "chest", variants: ["hanging"] } },
    { id: "large", label: "≥ 500 jeton", filter: { kind: "chest", minCoins: 500 } },
    { id: "bag", label: "Çantalar", filter: { kind: "bag" } },
    { id: "all", label: "Tümü", filter: {} },
    { id: "streams", label: "Canlı yayınlar", filter: { kind: "stream" } },
  ];

  function params() {
    return new URLSearchParams(global.location ? global.location.search : "");
  }

  function handleOf(value) {
    return String(value == null ? "" : value).replace(/^@+/, "").trim();
  }

  function liveUrl(username) {
    return "https://www.tiktok.com/@" + encodeURIComponent(handleOf(username)) + "/live";
  }

  function dataUrls() {
    var query = params();
    var custom = query.get("data") || "";
    try {
      custom = custom || global.localStorage.getItem("arenaData") || "";
    } catch (error) {
      custom = custom || "";
    }
    if (custom) return [custom];
    var urls = [RAW];
    // file:// üzerinden açıldıysa göreli yol çalışmaz; yalnızca ham adres kullanılır.
    if (global.location && /^https?:/.test(global.location.protocol)) urls.unshift("data/arena-live.json");
    return urls;
  }

  function panelUrl() {
    var query = params();
    var value = query.get("panel") || "";
    try {
      value = value || global.localStorage.getItem("arenaPanel") || "";
    } catch (error) {
      value = value || "";
    }
    return value ? String(value).replace(/\/+$/, "") : "";
  }

  async function fetchJson(url, timeoutMs) {
    var separator = url.indexOf("?") >= 0 ? "&" : "?";
    var response = await fetch(url + separator + "t=" + Date.now(), {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs || 9000),
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }

  async function loadSnapshot() {
    var urls = dataUrls();
    var failures = [];
    for (var i = 0; i < urls.length; i += 1) {
      try {
        var data = await fetchJson(urls[i]);
        if (!data || data.schema !== 1) throw new Error("Bilinmeyen veri biçimi");
        return { data: data, source: urls[i], fetchedAt: Date.now() };
      } catch (error) {
        failures.push(urls[i] + " → " + (error && error.message ? error.message : "hata"));
      }
    }
    throw new Error(failures.join(" · ") || "Veri alınamadı");
  }

  async function loadPanel(panel) {
    var data = await fetchJson(panel + "/api/chests?sort=opens_at&desc=1", 10000);
    var chests = Array.isArray(data.chests) ? data.chests : [];
    var flows = Array.isArray(data.flows) ? data.flows : [];
    return {
      data: {
        schema: 1,
        source: "panel",
        generatedAt: new Date().toISOString(),
        stats: { live: flows.length, chests: chests.length, candidates: 0, checked: 0, errors: 0 },
        streams: flows.map(function (flow) {
          return {
            username: flow.username,
            nickname: flow.nickname,
            title: flow.title || "Jeton akışı",
            viewers: flow.viewers,
            roomId: flow.roomId,
            diamondsPerMin: flow.diamondsPerMin,
            flow: true,
            openUrl: liveUrl(flow.username),
          };
        }),
        chests: chests,
        errors: data.error ? [data.error] : [],
      },
      source: panel,
      fetchedAt: Date.now(),
    };
  }

  function secondsLeft(chest) {
    var opens = Date.parse(chest && chest.opensAt ? chest.opensAt : "");
    if (!Number.isFinite(opens)) return 0;
    return Math.round((opens - Date.now()) / 1000);
  }

  function ratioOf(chest) {
    if (chest && Number.isFinite(Number(chest.ratio)) && Number(chest.ratio) > 0) return Number(chest.ratio);
    var coins = Number(chest && chest.coins ? chest.coins : 0);
    var slots = Math.max(1, Number(chest && chest.slots ? chest.slots : 1));
    return Math.round((coins / slots) * 100) / 100;
  }

  function matches(row, filter) {
    if (!filter) return true;
    if (filter.kind && filter.kind !== "stream" && row.kind !== filter.kind) return false;
    if (filter.variants && filter.variants.length && filter.variants.indexOf(row.variant) < 0) return false;
    if (Number.isFinite(filter.minRatio) && ratioOf(row) < filter.minRatio) return false;
    if (Number.isFinite(filter.minCoins) && Number(row.coins || 0) < filter.minCoins) return false;
    if (Number.isFinite(filter.maxSlots) && Number(row.slots || 0) > filter.maxSlots) return false;
    return true;
  }

  function filterChests(chests, filter) {
    return (chests || []).filter(function (row) {
      return matches(row, filter);
    });
  }

  function sortChests(rows, key, desc) {
    var direction = desc === false ? -1 : 1;
    var value = function (row) {
      switch (key) {
        case "coins": return Number(row.coins || 0);
        case "ratio": return ratioOf(row);
        case "per_slot": return Number(row.coins || 0) / Math.max(1, Number(row.slots || 1));
        case "slots": return Number(row.slots || 0);
        case "viewers": return Number(row.viewers || 0);
        case "detected": return -secondsLeft(row);
        case "opens_at":
        default: return secondsLeft(row);
      }
    };
    return rows.slice().sort(function (a, b) {
      return (value(a) - value(b)) * direction;
    });
  }

  function tabCounts(chests, streams) {
    var counts = {};
    TABS.forEach(function (tab) {
      counts[tab.id] =
        tab.id === "streams"
          ? (streams || []).length
          : filterChests(chests, tab.filter).length;
    });
    return counts;
  }

  function tabById(id) {
    for (var i = 0; i < TABS.length; i += 1) if (TABS[i].id === id) return TABS[i];
    return TABS[0];
  }

  function ageSeconds(snapshot) {
    var at = Date.parse(snapshot && snapshot.generatedAt ? snapshot.generatedAt : "");
    return Number.isFinite(at) ? Math.max(0, Math.round((Date.now() - at) / 1000)) : null;
  }

  function formatNumber(value) {
    var n = Number(value) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(".0", "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(".0", "") + "K";
    return new Intl.NumberFormat("tr-TR").format(n);
  }

  function formatDuration(seconds) {
    var s = Math.max(0, Math.round(seconds));
    if (s < 60) return s + " sn";
    var m = Math.floor(s / 60);
    if (m < 60) return m + " dk " + String(s % 60).padStart(2, "0") + " sn";
    return Math.floor(m / 60) + " sa " + String(m % 60).padStart(2, "0") + " dk";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  function clock(seconds) {
    var s = Math.max(0, Math.round(seconds));
    if (s < 60) return s + "s";
    var m = Math.floor(s / 60);
    if (m < 60) return m + ":" + String(s % 60).padStart(2, "0");
    return Math.floor(m / 60) + "h" + String(m % 60).padStart(2, "0");
  }

  global.ArenaData = {
    REPO: REPO,
    RAW: RAW,
    RELEASES: RELEASES,
    INSTALLER: INSTALLER,
    TABS: TABS,
    dataUrls: dataUrls,
    panelUrl: panelUrl,
    loadSnapshot: loadSnapshot,
    loadPanel: loadPanel,
    secondsLeft: secondsLeft,
    ratioOf: ratioOf,
    filterChests: filterChests,
    sortChests: sortChests,
    tabCounts: tabCounts,
    tabById: tabById,
    ageSeconds: ageSeconds,
    formatNumber: formatNumber,
    formatDuration: formatDuration,
    clock: clock,
    escapeHtml: escapeHtml,
    liveUrl: liveUrl,
  };
})(window);
