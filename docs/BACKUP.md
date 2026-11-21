# PostgreSQL yedekleme ve geri yükleme

Panel verisi `DATABASE_URL` ile gösterilen PostgreSQL veritabanında tutulur. Radar
JSON'u git'te (`data` dalı) ayrıca saklanır, ancak **panel verisinin (üyeler, sandıklar,
oturumlar, ayarlar) tek kopyası veritabanıdır**.

## Günlük yedek

Windows kurulumunda PostgreSQL `pg_dump` ile yedeklenir:

```bat
set BACKUP=%USERPROFILE%\ArenaRadar\backup
if not exist "%BACKUP%" mkdir "%BACKUP%"
pg_dump "%DATABASE_URL%" -Fc -f "%BACKUP%\arena-%DATE:~-4%%DATE:~3,2%%DATE:~0,2%.dump"
```

Linux/sunucu:

```bash
mkdir -p /var/backups/arena
pg_dump "$DATABASE_URL" -Fc -f "/var/backups/arena/arena-$(date +%F).dump"
# 14 günden eski yedekleri sil
find /var/backups/arena -name 'arena-*.dump' -mtime +14 -delete
```

`-Fc` (custom format) sıkıştırır ve tek tablo geri yüklemeye izin verir.

## Geri yükleme

```bash
pg_restore --clean --if-exists -d "$DATABASE_URL" /var/backups/arena/arena-2026-11-21.dump
```

Yalnızca bir tablo:

```bash
pg_restore -d "$DATABASE_URL" --table=live_rooms /var/backups/arena/arena-2026-11-21.dump
```

## Şema

Şema `src/db/schema.ts` içinde tanımlıdır ve `drizzle/` altındaki SQL migration'ları
commit edilir.

```bash
npm run db:generate    # şema değişince yeni migration üret
npm run db:migrate     # migration'ları uygula
```

Şema ile veritabanı uyuşmuyorsa panel açılışta `checkSchema()` ile eksik tablo/kolonu
konsola ve aktivite akışına yazar. Yeni bir kurulumda önce `db:migrate` çalıştırılmalıdır.

## Saklama süreleri

`src/server/retention.ts` günde bir kez çalışır:

| Tablo | Süre |
| --- | --- |
| `chests` | 45 gün |
| `live_events` | 30 gün |
| `activity_log` | 30 gün |
| `scan_tasks` | 14 gün |
| `radar_scans` | 90 gün |

`live_rooms`, `creators`, `agencies`, `revenue_entries` ve `settings` silinmez.
