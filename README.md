# GovOrbit

DarkOrbit tarzı çok oyunculu uzay demosu.

**Stack:** React + Phaser 3 · NestJS · Socket.io · TypeORM (SQLite varsayılan / PostgreSQL opsiyonel)

## DarkOrbit notu

Orijinal DarkOrbit kaynak kodu Bigpoint’a aittir ve buraya kopyalanamaz.
Bu demo, resmi Controls FAQ / wiki’deki herkese açık mekaniklerden esinlenen **özgün** bir implementasyondur. Ayrıntı: `LEGAL.md`.

## Özellikler (DO tarzı)

- WASD yok: tıkla git + basılı tutarak sür
- Hedef seç + **Ctrl** lazer / **çift tık** ile ateş başlat
- **Space** roket
- Kalkan + HP, lazer menzili
- Minimap (tıkla git)
- Jump portal, kargo kutusu, harita kenarı radyasyon

## Hızlı başlangıç (SQLite)

PostgreSQL veya Docker gerekmez; demo hemen çalışır.

```bash
npm install
npm run dev
```

- İstemci: http://localhost:5173
- Sunucu: http://localhost:3001

İki tarayıcı penceresi açıp farklı isimlerle girerek multiplayer’ı test edebilirsin.

## PostgreSQL ile çalıştırma

1. Postgres ayağa kaldır (Docker varsa):

```bash
docker compose up -d
```

2. `server/.env` oluştur:

```env
PORT=3001
DB_TYPE=postgres
DB_HOST=localhost
DB_PORT=5432
DB_USER=govorbit
DB_PASSWORD=govorbit
DB_NAME=govorbit
```

3. `npm run dev`

## Kontroller

| Tuş | Aksiyon |
|-----|---------|
| W A S D | Hareket |
| Fare | Nişan |
| Sol tık | Ateş |

## Mimari

```
client/          React (Vite) + Phaser canvas
server/          NestJS + GameGateway (Socket.io) + GameService (simülasyon)
docker-compose   PostgreSQL 16
```

Sunucu otoriterdir: hareket, mermi ve çarpışmalar sunucuda hesaplanır; istemci input gönderir ve snapshot çizer.

## Sonraki adımlar (fikir)

- Harita odaları / jump gate
- Gemi yükseltmeleri ve envanter
- Auth (JWT) + güvenli hesap
- Client-side prediction / reconciliation
- Daha zengin sprite / efekt katmanı
