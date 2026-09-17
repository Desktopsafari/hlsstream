#!/bin/bash
set -e
sudo mv /tmp/chat-package.json /opt/chat-service/package.json
sudo mv /tmp/chat-server.js /opt/chat-service/server.js
sudo mv /tmp/chat-profanity.js /opt/chat-service/profanity.js
sudo mv /tmp/chat-service.env /opt/chat-service/.env
sudo mv /tmp/chat-service.service /etc/systemd/system/chat-service.service
sudo chown -R chatservice:chatservice /opt/chat-service
sudo chmod 600 /opt/chat-service/.env

cd /opt/chat-service
sudo -u chatservice npm install --omit=dev

sudo systemctl daemon-reload
sudo systemctl enable --now chat-service.service
sleep 2
sudo systemctl status chat-service.service --no-pager | head -12
