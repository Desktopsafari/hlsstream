#!/bin/bash
# Inserts nginx-capture-locations.conf (copied to /tmp/nginx-capture-locations.conf)
# into the 443 server block of stream.conf, just before `location = /`, the
# same anchor add-chat-nginx.sh used. Keeps a dated backup, tests the config,
# and only reloads nginx if the test passes (otherwise restores the backup).
set -e

CONF=/etc/nginx/sites-enabled/stream.conf
BACKUP=/root/stream.conf.backup-$(date +%F-%H%M%S)

if grep -q "location /capture-api/" "$CONF"; then
  echo "capture locations already present, skipping insert"
else
  sudo cp "$CONF" "$BACKUP"
  echo "backup: $BACKUP"
  sudo python3 - <<'PYEOF'
path = "/etc/nginx/sites-enabled/stream.conf"
with open(path) as f:
    content = f.read()
with open("/tmp/nginx-capture-locations.conf") as f:
    block = f.read()

anchor = """    location = / {
        return 404;
    }"""
assert content.count(anchor) == 1, "anchor block not found exactly once"
indented = "\n".join(("    " + line) if line.strip() else "" for line in block.splitlines())
content = content.replace(anchor, indented + "\n\n" + anchor, 1)
with open(path, "w") as f:
    f.write(content)
PYEOF
fi

if sudo nginx -t; then
  sudo systemctl reload nginx
  echo "done"
else
  [ -f "$BACKUP" ] && sudo cp "$BACKUP" "$CONF" && echo "nginx -t failed: restored $BACKUP"
  exit 1
fi
