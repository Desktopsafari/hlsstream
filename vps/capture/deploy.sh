#!/bin/bash
# Installs or updates the capture buffer + capture service on the VPS.
# Expects the files of vps/capture/ copied to /tmp/capture/ first, plus:
#   /tmp/capture/capture.env   (from capture.env.example, with the real secret)
#   /tmp/capture/main.env      (RTMP_URL=..., only on the first install)
# Safe to run again: it never touches nginx-rtmp, the chat service or /hls.
set -e
SRC=/tmp/capture

id capture >/dev/null 2>&1 || sudo useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin capture

sudo install -d -o root -g root -m 755 /opt/capture-service
sudo install -d -o root -g root -m 755 /etc/capture /etc/capture/streams
sudo install -d -o capture -g capture -m 755 /var/lib/capture
sudo install -d -o capture -g capture -m 750 /var/lib/capture/buffer
# nginx (www-data) serves finished files from here, so it must be readable.
sudo install -d -o capture -g capture -m 755 /var/lib/capture/files

sudo install -o root -g root -m 644 "$SRC/server.mjs" "$SRC/window.mjs" "$SRC/package.json" /opt/capture-service/
sudo install -o root -g root -m 755 "$SRC/capture-buffer.sh" /opt/capture-service/
sudo install -o root -g root -m 644 "$SRC/capture-buffer@.service" "$SRC/capture-service.service" /etc/systemd/system/

if [ -f "$SRC/capture.env" ]; then
  sudo install -o root -g root -m 600 "$SRC/capture.env" /etc/capture/capture.env
  rm -f "$SRC/capture.env"
fi
if [ -f "$SRC/main.env" ]; then
  sudo install -o root -g root -m 600 "$SRC/main.env" /etc/capture/streams/main.env
  rm -f "$SRC/main.env"
fi

sudo systemctl daemon-reload
sudo systemctl enable capture-buffer@main.service capture-service.service
sudo systemctl restart capture-buffer@main.service capture-service.service
sleep 8
sudo systemctl status capture-buffer@main.service --no-pager | head -6
sudo systemctl status capture-service.service --no-pager | head -6
ls /var/lib/capture/buffer/main | tail -3
