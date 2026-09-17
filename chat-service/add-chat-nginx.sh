#!/bin/bash
set -e

if grep -q "location /chat" /etc/nginx/sites-enabled/stream.conf; then
  echo "chat location already present, skipping insert"
else
  sudo python3 - <<'PYEOF'
path = "/etc/nginx/sites-enabled/stream.conf"
with open(path) as f:
    content = f.read()

chat_block = """    location /chat {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    location = / {
        return 404;
    }"""

old = """    location = / {
        return 404;
    }"""

assert old in content, "anchor block not found"
content = content.replace(old, chat_block, 1)

with open(path, "w") as f:
    f.write(content)
PYEOF
fi

sudo nginx -t
sudo systemctl reload nginx
echo "done"
