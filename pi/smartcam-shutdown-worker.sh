#!/bin/bash
source /etc/smartcam.conf
SERVER="${SERVER%/}"
REQ_URL="$SERVER/api/pi-shutdown-request"
ACK_URL="$SERVER/api/pi-shutdown-ack"
AUTH=(-H "x-api-key: $API_KEY")
LAST_ID=""
echo "[shutdown-worker] started -> $SERVER"
while true; do
  RESP="$(curl -s --max-time 8 "${AUTH[@]}" "$REQ_URL")"
  REQUESTED="$(echo "$RESP" | grep -o '"requested":[^,}]*' | cut -d: -f2 | tr -d ' ')"
  REQUEST_ID="$(echo "$RESP" | grep -o '"request_id":"[^"]*"' | cut -d'"' -f4)"
  if [ "$REQUESTED" = "true" ] && [ -n "$REQUEST_ID" ] && [ "$REQUEST_ID" != "$LAST_ID" ]; then
    LAST_ID="$REQUEST_ID"
    echo "[shutdown-worker] shutdown request received id=$REQUEST_ID"
    curl -s --max-time 8 -X POST "${AUTH[@]}" "$ACK_URL" >/dev/null
    systemctl stop smartcam-upload-mini.service >/dev/null 2>&1
    systemctl stop smartcam-capture-worker.service >/dev/null 2>&1
    systemctl stop smartcam-status-report.timer >/dev/null 2>&1
    systemctl stop smartcam-wifi-watchdog.timer >/dev/null 2>&1
    sync
    echo "[shutdown-worker] shutting down safely now"
    /sbin/shutdown -h now
    exit 0
  fi
  sleep 5
done
