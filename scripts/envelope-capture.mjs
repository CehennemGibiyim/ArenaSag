import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Canlı WebSocket karesini replay fixture'ına çevirir.
 *
 * Kare olduğu gibi saklanır; yalnızca kimlikler, kullanıcı adları, avatarlar ve
 * URL'ler maskelenir. Koin/kişi/açılış zamanı gibi sayısal alanlara dokunulmaz,
 * böylece parser gerçek veriyle test edilmeye devam eder.
 */

const MASKED = {
  msgId: "7000000000000000003",
  roomId: "7000000000000000002",
  envelopeId: "7000000000000000001",
  userId: "7000000000000000004",
  userName: "masked_user",
};

const MASKED_FIELDS = [
  "common.msgId",
  "common.roomId",
  "common.displayText / describe",
  "envelopeInfo.envelopeId",
  "envelopeInfo.roomId",
  "envelopeInfo.sendUserId",
  "envelopeInfo.sendUserName",
  "avatar URL'leri",
  "kullanıcı yükü",
];

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function maskValue(value, key) {
  if (Array.isArray(value)) return value.map((item) => maskValue(item, key));
  if (isObject(value)) return maskObject(value);
  if (typeof value !== "string") return value;

  const name = String(key || "").toLowerCase();
  if (/^(msgid|msg_id)$/.test(name)) return MASKED.msgId;
  if (/^(roomid|room_id)$/.test(name)) return MASKED.roomId;
  if (/^(envelopeid|envelope_id|letterid|letter_id|parcelid|parcel_id)$/.test(name)) return MASKED.envelopeId;
  if (/^(senduserid|send_user_id|userid|user_id|uid|id)$/.test(name)) return MASKED.userId;
  if (/^(sendusername|send_user_name|nickname|nick_name|username)$/.test(name)) return MASKED.userName;
  if (/^(displaytext|display_text|describe|title)$/.test(name)) return "";
  if (/^https?:\/\//i.test(value)) return "";
  return value;
}

/**
 * Maskeli yükün alan yollarını (değerleri değil) çıkarır. Şema sürüklenmesi
 * raporunda hangi alanların geldiğini göstermek için kullanılır.
 */
export function envelopeFieldPaths(payload, { limit = 80 } = {}) {
  const fields = [];
  const seen = new Set();
  const walk = (value, prefix) => {
    if (fields.length >= limit) return;
    if (Array.isArray(value)) {
      if (!value.length) {
        if (prefix && !seen.has(`${prefix}[]`)) {
          seen.add(`${prefix}[]`);
          fields.push(`${prefix}[]`);
        }
        return;
      }
      walk(value[0], `${prefix}[]`);
      return;
    }
    if (isObject(value)) {
      for (const [key, child] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${key}` : key;
        walk(child, path);
        if (fields.length >= limit) return;
      }
      return;
    }
    if (prefix && !seen.has(prefix)) {
      seen.add(prefix);
      fields.push(prefix);
    }
  };
  walk(isObject(payload) ? payload : {}, "");
  return fields;
}

/**
 * Bilinmeyen bir zarf tipinin artifact'a konacak maskeli örneği. Ham kare
 * olduğu gibi değil, `maskEnvelopePayload` ile aynı maskeleme kurallarından
 * geçmiş hâliyle saklanır; yalnızca alan adları rapora eklenir.
 */
export function unknownEnvelopeSample(raw, { method = "WebcastEnvelopeMessage", capturedAt = new Date(), event = "decodedData" } = {}) {
  const fixture = maskEnvelopePayload(raw, { method, capturedAt, event });
  return {
    type: method,
    capturedAt: fixture.source.capturedAt,
    fields: envelopeFieldPaths(fixture.payload),
    sample: fixture.payload,
  };
}

function maskObject(value) {
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    const name = String(key).toLowerCase();
    // Kullanıcı/avatar nesneleri parser için gerekli değil; serbest metin ve
    // URL taşıyabilecekleri için tamamen boşaltılır.
    if (/^(senduseravatar|avatar|avatarthumb|avatarmedium|avatarlarge)$/.test(name)) {
      out[key] = isObject(child) ? { urlList: [] } : "";
      continue;
    }
    if (/^(url|urllist)$/.test(name)) {
      out[key] = Array.isArray(child) ? [] : "";
      continue;
    }
    if (/^(user|userinfo|owner)$/.test(name)) {
      out[key] = isObject(child) ? {} : "";
      continue;
    }
    out[key] = maskValue(child, key);
  }
  return out;
}

/** Ham kareyi (veya `{ data: ... }` sarmalını) maskeli fixture nesnesine çevirir. */
export function maskEnvelopePayload(raw, { capturedAt = new Date(), method = "WebcastEnvelopeMessage", event = "envelope" } = {}) {
  const record = isObject(raw) ? raw : {};
  // Connector bazı sürümlerde mesajı `{ data: ... }` sarmalıyla verir; fixture
  // her zaman doğrudan Webcast mesajını taşısın ki replay parser'ı sade kalsın.
  const payload = maskObject(isObject(record.data) ? record.data : record);
  if (!isObject(payload.common)) payload.common = {};
  if (!payload.common.method) payload.common.method = method;
  return {
    fixture: "webcast-envelope-message",
    source: {
      method,
      event,
      capturedFrom: "ArenaSag radar canlı WebSocket",
      capturedAt: new Date(capturedAt).toISOString(),
      masked: [...MASKED_FIELDS],
      note: "Radarın canlı dinlemede yakaladığı kare; kimlikler, kullanıcı alanları ve URL'ler maskelendi.",
    },
    payload,
  };
}

/** Fixture'ı önce geçici dosyaya yazıp yeniden adlandırır; yarım dosya bırakmaz. */
export async function writeEnvelopeFixture(raw, file, options = {}) {
  const fixture = maskEnvelopePayload(raw, options);
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  await rename(temporary, target);
  return fixture;
}

/**
 * Dinleyiciye takılabilecek tek kullanımlık yakalama adımı: ilk gerçek
 * WebcastEnvelopeMessage karesini yazar, sonrakileri yok sayar. Yazma
 * başarısız olursa sonraki kareyle yeniden dener.
 */
export function createEnvelopeCapture(file, { log = () => {} } = {}) {
  let done = false;
  let pending = null;
  return (raw) => {
    if (done) return Promise.resolve(null);
    if (pending) return pending;
    pending = writeEnvelopeFixture(raw, file)
      .then((fixture) => {
        done = true;
        log(`zarf fixture yazıldı: ${file}`);
        return fixture;
      })
      .catch((error) => {
        log(`zarf fixture yazılamadı: ${error instanceof Error ? error.message : "hata"}`);
        return null;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}
