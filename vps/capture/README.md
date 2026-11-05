# Capture service (VPS)

Clips (and admin photos) for the "Capture" feature. Visitor photos are taken
in the browser and never reach this service unless the browser can't do it.

```
Pi --RTMP--> nginx-rtmp --HLS 4 s--> /var/www/hls        (public player, unchanged)
                 |
                 +--RTMP (local)--> capture-buffer@main   ffmpeg -c copy, 2 s segments,
                                    /var/lib/capture/buffer/main   last ~150 s, on disk
                                          |
website server --HTTPS /capture-api/--> capture-service (127.0.0.1:3002)
                                          |  clip: concat segments -c copy -> mp4 (+faststart) + thumb
                                          |  photo: frame at the shifted time + watermark + thumb
                                          v
                                    /var/lib/capture/files  --nginx--> /captures/f/<name>  (inline)
                                                                      /captures/dl/<name> (download)
```

| File | Goes to |
|---|---|
| `server.mjs`, `window.mjs`, `package.json` | `/opt/capture-service/` |
| `capture-buffer.sh` | `/opt/capture-service/` (755) |
| `capture-buffer@.service`, `capture-service.service` | `/etc/systemd/system/` |
| `capture.env.example` -> `capture.env` | `/etc/capture/capture.env` (600, holds `CAPTURE_SECRET`) |
| `main.env` (not in the repo) | `/etc/capture/streams/main.env` (600, `RTMP_URL=` with the publish app name) |
| `nginx-capture-locations.conf` | inserted into the 443 block of `/etc/nginx/sites-enabled/stream.conf` by `add-capture-nginx.sh` |

Nothing here touches the `rtmp {}` block, the chat service or `/hls`.

## API (all need the `X-Capture-Secret` header)

- `POST /capture-api/capture` `{stream, kind: "photo"|"clip", seconds, behind_live_seconds, id}`
  - `id`: 22 url-safe characters chosen by the website (128 random bits); files are
    `<id>.mp4` / `<id>.jpg` and `<id>-t.jpg`.
  - `behind_live_seconds` (0-150) is how far behind the buffer's live point to
    capture; it is clamped to what the buffer holds, never refused.
  - Errors: 400 invalid, 401, 409 `offline` / `not_enough_buffer`, 503 `busy`
    (2 jobs running + 4 waiting), 507 `disk_full` (under `CAPTURE_MIN_FREE_GB`, default 10).
- `DELETE /capture-api/files` `{names: [...]}`: deletes; files already gone count as done.
- `GET /capture-api/status`: live / seconds held per stream, free disk, bytes in the files folder.

## Adding the fish tank later

1. `/etc/capture/streams/fish.env` with its `RTMP_URL=`.
2. `CAPTURE_STREAMS=main,fish` in `/etc/capture/capture.env`, restart `capture-service`.
3. `systemctl enable --now capture-buffer@fish`.

## Hourly cleanup cron (root crontab)

Same pattern as the push cron. `/root/.capture-cron-header` (mode 600) holds one
line, `Authorization: Bearer <CAPTURE_CRON_SECRET>`. The crontab line:

```
17 * * * * curl -fsS -m 50 -o /dev/null -H @/root/.capture-cron-header https://www.desktopsafari.com/api/cron/cleanup-captures
```

## Optional: 1 GB swap file (separate step, not part of deploy.sh)

The droplet has 961 MB RAM and no swap. A swap file is a safety net if two
ffmpeg jobs and everything else spike together:

```
fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl vm.swappiness=10
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
```

Undo: `swapoff /swapfile && rm /swapfile`, remove the fstab line and the sysctl file.
