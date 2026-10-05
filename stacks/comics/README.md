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

`docker-compose.qnap.yml` is set up for a QNAP that already runs an *arr
stack behind Traefik in Container Station: QNAP paths, everything as root
like the other containers, and Komga published at `comics.jayflix.ink`.

1. **Create the folders** over SSH (`ssh admin@<nas-ip>`):
   ```bash
   mkdir -p /share/CACHEDEV1_DATA/docker/{kapowarr,komga,shelfmark} \
     /share/CACHEDEV1_DATA/Comics/{comics,books} \
     /share/CACHEDEV1_DATA/Downloads/kapowarr
   ```
   Comics and books go in subfolders of the `Comics` share, not its top
   level, so Kapowarr never mistakes the books for comic volumes.
2. **Add the services to the existing app.** Container Station →
   Applications → your stack → Edit. Paste the `kapowarr`, `komga` and
   `shelfmark` blocks under `services:` (not the `networks:` part, the
   app already has `proxy`), then Validate and Update. Being in the same
   app is what puts them on Traefik's `proxy` network.
3. **DNS:** add a `comics` record for jayflix.ink pointing where
   `maintainerr` points. Traefik fetches the certificate on the first visit.
4. Carry on from step 2 below, using `http://<nas-ip>:5656`, `:25600`
   and `:8084`. Only Komga goes through Traefik: it has its own login.
   Kapowarr and Shelfmark stay on your home network.

QNAP notes:
- **Memory:** on a 4 GB NAS that also runs Sonarr, Radarr and friends,
  Komga is capped at 768 MB. Raise `-Xmx` if you add RAM.
- **NZBGet in Shelfmark:** Shelfmark mounts `Downloads` at `/downloads`,
  the same path NZBGet uses, so you can add NZBGet as its download client.
- **Updating:** Container Station → the app → Edit → Update with
  "pull images" ticked, or over SSH `docker pull` the image and recreate.

## 2. Kapowarr (http://server:5656)

1. **Settings → General**: get a free API key from
   [Comic Vine](https://comicvine.gamespot.com/api/) and paste it in. Kapowarr
   can't search without it.
2. **Settings → Media Management → Root folders**: add `/comics`.
3. **Settings → General → FlareSolverr base URL**: `http://flaresolverr:8191`
   (QNAP file only; it includes FlareSolverr). GetComics is behind
   Cloudflare, and without it every search comes back empty with
   "Request blocked by CloudFlare and FlareSolverr not setup" in the logs.
4. **Settings → General → Authentication**: set a password if the server is
   reachable from outside your home network.
5. **Add Volume**, search a series, add it, then **Search Monitored**.

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
PDF. The QNAP file also runs [Audiobookshelf](https://www.audiobookshelf.org)
(port 13378, `audiobooks.jayflix.ink`) for audiobooks: set Shelfmark's
audiobook destination to `/audiobooks`, and add a library in Audiobookshelf
with the folder `/audiobooks`.

## Updating

```bash
docker compose pull && docker compose up -d
```

## Reaching it from outside your home

Don't open these ports on your router. Use Tailscale/WireGuard, or a reverse
proxy (Caddy, Nginx Proxy Manager, Traefik) with HTTPS, and keep Kapowarr and
Shelfmark behind a login.
