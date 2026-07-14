# GovOrbit

DarkOrbit tarzı çok oyunculu uzay demosu.

**Stack:** React + Phaser 3 · NestJS · Socket.io · TypeORM (SQLite yerel / PostgreSQL üretim)

## Neden SQLite üretimde yetmez?

SQLite dosyası sunucu diskinde durur. Render / Railway gibi platformlarda disk **ephemeral** olduğu için her deploy’da dosya silinir → kayıtlar, kredi, hangar kaybolur.

Üretimde **managed PostgreSQL** kullan (Neon, Supabase, Render Postgres…). Sunucuya sadece `DATABASE_URL` ver.

## Hızlı başlangıç (SQLite — sadece lokal)

PostgreSQL veya Docker gerekmez; demo hemen çalışır.

```bash
npm install
npm run dev
```

- İstemci: http://localhost:5173
- Sunucu: http://localhost:3001

## Üretim: kalıcı Postgres (önerilen)

1. [Neon](https://neon.tech) (ücretsiz) veya Supabase’de proje aç → connection string kopyala.
2. Oyun sunucusunun (Render vb.) Environment değişkenlerine ekle:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require
CORS_ORIGIN=https://SENIN-VERCEL-URL.vercel.app
```

3. Redeploy et. `DATABASE_URL` varsa SQLite kullanılmaz; hesaplar deploy’lar arasında kalır.

Lokal Postgres (Docker):

```bash
docker compose up -d
```

`server/.env`:

```env
PORT=3001
DB_TYPE=postgres
DB_HOST=localhost
DB_PORT=5432
DB_USER=govorbit
DB_PASSWORD=govorbit
DB_NAME=govorbit
```

veya:

```env
DATABASE_URL=postgresql://govorbit:govorbit@localhost:5432/govorbit
DB_SSL=false
```

## Kontroller

| Tuş | Aksiyon |
|-----|---------|
| Sol tık | Git / hedef |
| Çift tık | Hedef + lazer |
| Ctrl | Lazer |
| Space | Roket |

## Mimari

```
client/          React (Vite) + Phaser canvas  → Vercel
server/          NestJS + Socket.io            → Render / Railway / VPS
postgres         Neon / Supabase / Docker      → kalıcı oyuncu verisi
```

Sunucu otoriterdir: hareket, mermi ve çarpışmalar sunucuda hesaplanır; istemci input gönderir ve snapshot çizer.