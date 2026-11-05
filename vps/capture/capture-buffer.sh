#!/bin/bash
# Rewind buffer for one stream key: started by capture-buffer@<key>.service.
# Reads the local RTMP feed (no re-encoding, -c copy) and keeps the last
# ~150 s as 2 s segments in /var/lib/capture/buffer/<key>/. The Pi already
# sends a keyframe every 2 s, so the cuts land exactly on 2 s.
#
# The RTMP address contains the publish secret (the nginx-rtmp application
# name), so it lives only on the VPS in /etc/capture/streams/<key>.env as
# RTMP_URL=rtmp://127.0.0.1:1935/<application>/<stream name>
set -euo pipefail

KEY="$1"
[[ "$KEY" =~ ^[a-z0-9-]{1,32}$ ]] || { echo "bad stream key"; exit 2; }
: "${RTMP_URL:?RTMP_URL is not set in /etc/capture/streams/$KEY.env}"

DIR="/var/lib/capture/buffer/$KEY"
mkdir -p "$DIR"
# A restart is a new feed: start from an empty buffer.
find "$DIR" -maxdepth 1 -type f \( -name 'seg-*' -o -name 'live.m3u8*' \) -delete

# 75 x 2 s = 150 s in the playlist; delete_threshold keeps 3 more on disk so a
# clip job reading the oldest segments never loses one mid-read.
exec /usr/bin/ffmpeg -hide_banner -loglevel warning -nostdin \
  -rw_timeout 15000000 -i "$RTMP_URL" \
  -map 0 -c copy \
  -f hls -hls_time 2 -hls_list_size 75 -hls_delete_threshold 3 \
  -hls_flags delete_segments+independent_segments+temp_file \
  -hls_segment_filename "$DIR/seg-%d.ts" \
  "$DIR/live.m3u8"
