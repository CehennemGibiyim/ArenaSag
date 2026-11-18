/* Arena Live OS — ortak panel kabuğu, gezinme ve canlı veri bağlantısı */
(function (global) {
  "use strict";

  var D = global.ArenaData;

  var ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    studio: '<rect x="2" y="5" width="14" height="14" rx="3"/><path d="m16 10 5-3v10l-5-3"/><circle cx="9" cy="12" r="2.4"/>',
    radar: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12 18 6"/><circle cx="12" cy="12" r="1"/>',
    radio: '<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
    gift: '<rect x="3" y="9" width="18" height="12" rx="2"/><path d="M3 13h18M12 9v12"/><path d="M12 9c-1-3-3-4-4.5-2.5S8.5 9 12 9Zm0 0c1-3 3-4 4.5-2.5S15.5 9 12 9Z"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.5a3 3 0 0 1 0 6M18 14.5c2 .7 3 2.5 3 5"/>',
    building: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/>',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14h2"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M8 13h.01M16 13h.01M9 17h6"/>',
    spark: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="M19 16.5 19.8 19l2.2.8-2.2.7-.8 2.5-.8-2.5-2.2-.7 2.2-.8.8-2.5Z"/>',
    library: '<path d="M4 5h5v14H4zM11 5h4v14h-4z"/><path d="m17 6 3.2-.8 2 13-3.2.8"/>',
    download: '<path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5"/><path d="M4 18v2h16v-2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.4-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.2 9a3 3 0 0 1 5.8 1c0 2-3 2.2-3 4"/><path d="M12 17.5h.01"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/>',
    arrow: '<path d="M5 12h14m0 0-5-5m5 5-5 5"/>',
    external: '<path d="M14 4h6v6M20 4l-8 8"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    play: '<path d="M8 5.5v13l11-6.5-11-6.5Z"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.9-4M4 5v5h5"/><path d="M4 13a8 8 0 0 0 14.9 4M20 19v-5h-5"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    signal: '<path d="M4 19v-3M9 19v-7M14 19V9M19 19V5"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  };

  function icon(name, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 16) + '" height="' + (size || 16) + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.grid) + "</svg>";
  }

  var NAV = [
    {
      title: "GENEL",
      items: [
        { label: "Panel", href: "index.html", icon: "grid", page: "panel" },
        { label: "Canlı Stüdyo", href: "yayinlar.html#studio", icon: "studio", page: "studio", badge: "LIVE" },
        { label: "Radar", href: "sandik.html?tab=all", icon: "radar", page: "sandik" },
        { label: "Canlı Yayınlar", href: "yayinlar.html", icon: "radio", page: "yayinlar", badge: "PIN" },
        { label: "Sandık Radarı", href: "sandik.html", icon: "gift", page: "sandik", badge: "YENİ", mint: true },
      ],
    },
    {
      title: "YÖNETİM",
      items: [
        { label: "Hesaplar", href: "yardim.html#tam-panel", icon: "users", page: "yardim", full: true },
        { label: "Ajanslar", href: "yardim.html#tam-panel", icon: "building", page: "yardim", full: true },
        { label: "Fırsatlar", href: "yardim.html#tam-panel", icon: "briefcase", page: "yardim", full: true },
        { label: "Gelir", href: "yardim.html#tam-panel", icon: "wallet", page: "yardim", full: true },
      ],
    },
    {
      title: "OTOMASYON",
      items: [
        { label: "Bot & Uyarılar", href: "yardim.html#otomasyon", icon: "bot", page: "yardim", full: true },
        { label: "AI Koç", href: "yardim.html#otomasyon", icon: "spark", page: "yardim", full: true },
      ],
    },
    {
      title: "PLATFORM",
      items: [
        { label: "Kütüphane", href: "https://github.com/CehennemGibiyim/ArenaSag/tree/main/web", icon: "library", external: true },
        { label: "Windows Paketi", href: D ? D.RELEASES : "https://github.com/CehennemGibiyim/ArenaSag/releases/latest", icon: "download", external: true },
        { label: "Yardım", href: "yardim.html", icon: "help", page: "yardim" },
        { label: "Ayarlar", href: "ayarlar.html", icon: "settings", page: "ayarlar" },
      ],
    },
  ];

  function esc(value) {
    return D ? D.escapeHtml(value) : String(value == null ? "" : value);
  }

  function navHtml() {
    var page = document.body.dataset.page || "";
    return NAV.map(function (group) {
      return (
        '<div class="nav-group"><p class="nav-title">' + group.title + "</p>" +
        group.items
          .map(function (item) {
            var active = item.page === page && !item.full ? " active" : "";
            var badge = item.badge
              ? '<span class="nav-badge' + (item.mint ? " mint" : "") + '">' + item.badge + "</span>"
              : "";
            var lock = item.full ? '<span class="nav-chevron" title="Tam panel Windows uygulamasında">' + icon("lock", 12) + "</span>" : "";
            return (
              '<a class="nav-item' + active + '" href="' + item.href + '"' +
              (item.external ? ' target="_blank" rel="noreferrer"' : "") +
              (item.full ? ' title="Hesaplar, ajanslar ve gelir modülleri tam panelde çalışır"' : "") +
              ">" + icon(item.icon) + '<span class="label">' + item.label + "</span>" + badge + lock + "</a>"
            );
          })
          .join("") +
        "</div>"
      );
    }).join("");
  }

  function sidebarMarkup() {
    return (
      '<div class="brand"><span class="brand-mark">A</span><span><span class="brand-name">ARENA</span><span class="brand-sub">Live OS · V1.4</span></span></div>' +
      '<nav class="nav" aria-label="Panel menüsü">' + navHtml() + "</nav>" +
      '<div class="connector-card"><div class="connector-head"><i class="dot" data-connector-dot></i><strong>GitHub Radar</strong></div>' +
      '<p data-connector-text>Tarama verisi bağlanıyor…</p>' +
      '<a href="yardim.html#otomasyon">Nasıl çalışır? ' + icon("arrow", 12) + "</a></div>" +
      '<div class="user-row"><span class="user-avatar">CY</span><span class="meta"><strong>Cehennem Yönetim</strong><span>Elite Partner</span></span>' +
      '<a class="icon-btn" href="ayarlar.html" title="Ayarlar">' + icon("settings", 14) + "</a></div>"
    );
  }

  function topbarMarkup() {
    return (
      '<button class="icon-btn hamburger" data-menu aria-label="Menüyü aç">' + icon("menu", 18) + "</button>" +
      '<div class="crumbs"><span>Arena</span><span>/</span><strong data-crumb>Panel</strong></div>' +
      '<label class="top-search">' + icon("search", 14) +
      '<input type="search" placeholder="Yayıncı, ajan, fırsat ara…" data-search aria-label="Ara" />' +
      "<kbd>↵</kbd></label>" +
      '<div class="top-actions">' +
      '<span class="status-pill"><i class="dot" data-status-dot></i><span data-status-text>Bağlanıyor</span></span>' +
      '<button class="icon-btn bell" data-bell title="Bildirimler" aria-label="Bildirimler">' + icon("bell", 15) + "</button>" +
      '<a class="btn primary" href="yayinlar.html#studio">' + icon("play", 12) + " Yeni yayın</a>" +
      "</div>"
    );
  }

  function mount() {
    var sidebar = document.querySelector("[data-sidebar]");
    var topbar = document.querySelector("[data-topbar]");
    if (sidebar) sidebar.innerHTML = sidebarMarkup();
    if (topbar) topbar.innerHTML = topbarMarkup();

    if (document.body.dataset.crumb) {
      var crumb = document.querySelector("[data-topbar] [data-crumb]");
      if (crumb) crumb.textContent = document.body.dataset.crumb;
    }

    var menu = document.querySelector("[data-menu]");
    var backdrop = document.querySelector("[data-backdrop]");
    if (menu && sidebar) {
      menu.addEventListener("click", function () {
        sidebar.classList.add("open");
        if (backdrop) backdrop.classList.add("show");
      });
    }
    if (backdrop && sidebar) {
      backdrop.addEventListener("click", function () {
        sidebar.classList.remove("open");
        backdrop.classList.remove("show");
      });
    }

    var search = document.querySelector("[data-search]");
    if (search) {
      search.addEventListener("keydown", function (event) {
        if (event.key !== "Enter") return;
        event.preventDefault();
        var value = search.value.trim();
        if (!value) return;
        if (typeof global.PanelPage?.search === "function") {
          global.PanelPage.search(value);
        } else {
          global.location.href = "sandik.html?q=" + encodeURIComponent(value);
        }
      });
    }

    var bell = document.querySelector("[data-bell]");
    if (bell) {
      bell.addEventListener("click", function () {
        if (!("Notification" in global)) return toast("Tarayıcı bildirimleri desteklenmiyor.");
        if (Notification.permission === "granted") {
          new Notification("Arena Radar", { body: "Yeni sandık bulunduğunda burada uyarı görünecek." });
          return;
        }
        Notification.requestPermission().then(function (permission) {
          toast(permission === "granted" ? "Bildirimler açıldı." : "Bildirim izni verilmedi.");
        });
      });
    }
  }

  var toastTimer = null;
  function toast(message) {
    var el = document.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("show");
    }, 2600);
  }

  var state = {
    snapshot: null,
    source: "",
    error: "",
    updatedAt: null,
    loading: false,
    refresh: 10,
  };

  function refreshSeconds() {
    try {
      var value = Number(global.localStorage.getItem("arenaRefresh"));
      if (Number.isFinite(value) && value >= 5 && value <= 120) return value;
    } catch (error) { /* özel mod */ }
    return 10;
  }

  function ageText() {
    var age = state.snapshot ? D.ageSeconds(state.snapshot) : null;
    if (age == null) return "veri yok";
    if (age < 90) return age + " sn önce";
    return Math.round(age / 60) + " dk önce";
  }

  function paintStatus() {
    var stale = state.snapshot ? D.ageSeconds(state.snapshot) > 900 : false;
    var tone = state.error ? "bad" : stale ? "warn" : "ok";
    document.querySelectorAll("[data-status-dot], [data-connector-dot]").forEach(function (dot) {
      dot.className = "dot" + (tone === "ok" ? "" : " " + tone);
    });
    var statusText = document.querySelector("[data-status-text]");
    if (statusText) statusText.textContent = state.error ? "Bağlantı yok" : "GitHub Radar · " + ageText();
    var connector = document.querySelector("[data-connector-text]");
    if (connector) {
      connector.textContent = state.error
        ? "Veri alınamadı: " + state.error
        : state.snapshot
          ? "Tarama " + ageText() + " güncellendi. " + ((state.snapshot.streams || []).length) + " canlı oda, " + ((state.snapshot.chests || []).length) + " sandık."
          : "Tarama verisi bağlanıyor…";
    }
    document.querySelectorAll("[data-fresh]").forEach(function (el) {
      el.textContent = state.error ? "Veri hatası" : state.snapshot ? "veri " + ageText() : "yükleniyor…";
    });
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    try {
      var result = await D.loadSnapshot();
      state.snapshot = result.data;
      state.source = result.source;
      state.error = "";
      state.updatedAt = Date.now();
      if (global.PanelPage && typeof global.PanelPage.render === "function") {
        global.PanelPage.render(result.data, { source: result.source, age: D.ageSeconds(result.data) });
      }
      paintStatus();
    } catch (error) {
      state.error = (error && error.message) || "bilinmeyen hata";
      paintStatus();
      if (global.PanelPage && typeof global.PanelPage.error === "function") global.PanelPage.error(state.error);
    } finally {
      state.loading = false;
    }
  }

  function setRefresh(seconds) {
    state.refresh = seconds;
    if (global.__arenaTimer) clearInterval(global.__arenaTimer);
    global.__arenaTimer = setInterval(load, Math.max(5, seconds) * 1000);
  }

  function boot() {
    mount();
    state.refresh = refreshSeconds();
    load();
    setRefresh(state.refresh);
    setInterval(function () {
      paintStatus();
      if (global.PanelPage && typeof global.PanelPage.tick === "function" && state.snapshot) {
        global.PanelPage.tick(state.snapshot);
      }
    }, 1000);
  }

  global.ArenaPanel = {
    icon: icon,
    toast: toast,
    load: load,
    setRefresh: setRefresh,
    state: state,
    ageText: ageText,
    esc: esc,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
