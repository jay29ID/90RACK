# Comics stack: Kapowarr + Komga + Shelfmark

A small Docker Compose stack for a comic library on your server:

| App | Port | Does |
| --- | --- | --- |
| [Kapowarr](https://github.com/Casvt/Kapowarr) | 5656 | Like Sonarr, for comics. Add a volume, it finds every issue (GetComics, with Mega/MediaFire/Pixeldrain etc.), downloads, unpacks and renames it into your library |
| [Komga](https://komga.org) | 25600 | The reader. Web reader, OPDS feed for phone/tablet apps, read progress, Kobo sync |
| [Shelfmark](https://github.com/calibrain/shelfmark) | 8084 | Book and audiobook search/downloader. Not a comics tool, but its downloads land in a "Books" library Komga also serves, so novels and art books live next to your comics |

```
DATA_ROOT/
  comics/               Kapowarr writes here   →  Komga "Comics" library (/data/comics)
  books/                Shelfmark writes here  →  Komga "Books" library  (/data/books)
  downloads/kapowarr/   Kapowarr's temp folder
CONFIG_ROOT/
  kapowarr/  komga/  shelfmark/
```

## 1. Start it

```bash
cd stacks/comics
cp .env.example .env        # set CONFIG_ROOT, DATA_ROOT, PUID/PGID, TZ
source .env && mkdir -p "$CONFIG_ROOT"/{kapowarr,komga,shelfmark} \
  "$DATA_ROOT"/{comics,books,downloads/kapowarr}
sudo chown -R "$PUID:$PGID" "$CONFIG_ROOT" "$DATA_ROOT"/{comics,books,downloads}
docker compose up -d
```

Create the folders before the first `up`: otherwise Docker creates them as
root and Komga (which runs as `PUID:PGID`) can't write its config.

## On a QNAP

Use `docker-compose.qnap.yml` instead of step 1's commands: it has QNAP
paths filled in and needs no `.env`, so Container Station can take it as is.

1. **Install Container Station** from the App Center if you haven't.
2. **Find your user's IDs.** Control Panel → Network & File Services →
   Telnet/SSH → enable SSH. Then `ssh admin@<nas-ip>` and run
   `id <your-qnap-username>`. Put the `uid` and `gid` numbers into the
   `user:` / `PUID` / `PGID` lines marked `← CHANGE` (QNAP users usually
   start at uid 500, group `everyone` is gid 100). Set `TZ` too.
3. **Create the folders** in File Station (or over SSH with `mkdir -p`):
   - `Container/comics-stack/kapowarr`, `.../komga`, `.../shelfmark`
   - `Multimedia/Comics`, `Multimedia/Books`, `Multimedia/Downloads/kapowarr`

   then, over SSH, give them to your user:
   ```bash
   chown -R 500:100 /share/Container/comics-stack /share/Multimedia/Comics \
     /share/Multimedia/Books /share/Multimedia/Downloads/kapowarr   # your uid:gid
   ```
   (Rather keep them somewhere other than `Multimedia`? Change the paths in
   the file; just keep `Comics` and `Books` the same in every service.)
4. **Deploy:** Container Station → **Applications** → **Create**, name it
   `comics`, paste in `docker-compose.qnap.yml`, **Validate**, **Create**.
   Or over SSH: copy the file to the NAS and run
   `docker compose -f docker-compose.qnap.yml up -d`.
5. Carry on from step 2 below, using `http://<nas-ip>:5656`, `:25600`
   and `:8084`.

QNAP notes:
- **ARM models** (TS-x33, TS-x32 etc.): Kapowarr, Komga and Shelfmark all
  publish arm64 images. Older 32-bit ARM NASes can run Komga but not
  Kapowarr or Shelfmark.
- **Low RAM**: Komga is Java and the hungriest of the three. The QNAP file
  caps it at 1 GB, which is fine for a big library; drop to `-Xmx512m` on a
  2 GB NAS.
- **Myqnapcloud / router port forwarding**: don't forward these ports.
  Use QNAP's own QVPN or Tailscale (in the App Center) to read away from home.
- **Updating**: over SSH, in the folder with the file:
  `docker compose -f docker-compose.qnap.yml pull && docker compose -f docker-compose.qnap.yml up -d`.

## 2. Kapowarr (http://server:5656)

1. **Settings → General**: get a free API key from
   [Comic Vine](https://comicvine.gamespot.com/api/) and paste it in. Kapowarr
   can't search without it.
2. **Settings → Media Management → Root folders**: add `/comics`.
3. **Settings → General → Authentication**: set a password if the server is
   reachable from outside your home network.
4. **Add Volume**, search a series, add it, then **Search Monitored**.

Optional: under **Settings → Download Clients** add a Mega account (higher
download limit) or a torrent client.

Kapowarr runs as root inside its container, so the files it writes are owned
by root. That's fine for Komga (it only reads). If you want them owned by
you, add `user: ${PUID}:${PGID}` to the kapowarr service and `chown` its
folders to match.

## 3. Komga (http://server:25600)

1. The first visit asks you to create the admin account.
2. **Libraries → +**: add a **Comics** library with root folder `/data/comics`.
   Kapowarr's one-folder-per-volume layout is exactly what Komga wants (each
   folder becomes a series).
3. Add a **Books** library with root folder `/data/books` for Shelfmark's
   downloads.
4. In each library's settings, turn on **Scan on startup** and
   **Periodic scan** (or **Watch folder**) so new downloads show up on
   their own.

To read on a phone or tablet, point an OPDS app (Panels, Chunky, Mihon/Tachiyomi
with the Komga extension, KyBook…) at `http://server:25600/opds/v1.2/catalog`
and log in with your Komga account.

## 4. Shelfmark (http://server:8084)

1. Search for a book and download it; it lands in `DATA_ROOT/books` and
   Komga picks it up on its next scan.
2. If you want Shelfmark to use a torrent or Usenet client, mount that
   client's download folder in the compose file at exactly the same path the
   client uses (there's a commented-out line for it), then add the client in
   Shelfmark's settings.

Shelfmark handles ebooks (EPUB, PDF…) and audiobooks. Komga reads EPUB and
PDF; for audiobooks point Shelfmark at a separate folder served by
Audiobookshelf instead.

## Updating

```bash
docker compose pull && docker compose up -d
```

## Reaching it from outside your home

Don't open these ports on your router. Use Tailscale/WireGuard, or a reverse
proxy (Caddy, Nginx Proxy Manager, Traefik) with HTTPS, and keep Kapowarr and
Shelfmark behind a login.
