#!/bin/bash
source /etc/smartcam.conf
SERVER="${SERVER%/}"
IFACE="wlan0"
FAIL_FILE="/tmp/smartcam-wifi-fails"
CONN="$(nmcli -t -f NAME,DEVICE connection show --active | awk -F: '$2=="wlan0"{print $1; exit}')"
[ -z "$CONN" ] && CONN="preconfigured"

if nmcli -t -f DEVICE,STATE dev status | grep -q "^${IFACE}:connected"; then
  # فحص الوصول للسيرفر عبر HTTP
  if curl -s --max-time 8 -o /dev/null -f "$SERVER/api/ping"; then
    echo 0 > "$FAIL_FILE"
    exit 0
  fi
fi

FAILS=0
[ -f "$FAIL_FILE" ] && FAILS="$(cat "$FAIL_FILE" 2>/dev/null || echo 0)"
FAILS=$((FAILS + 1))
echo "$FAILS" > "$FAIL_FILE"
if [ "$FAILS" -lt 3 ]; then
  echo "[wifi-watchdog] temporary fail $FAILS/3, no restart"
  exit 0
fi
echo "[wifi-watchdog] reconnecting Wi-Fi after $FAILS fails"
nmcli radio wifi on >/dev/null 2>&1
nmcli connection up "$CONN" ifname "$IFACE" >/dev/null 2>&1 || nmcli device connect "$IFACE" >/dev/null 2>&1
echo 0 > "$FAIL_FILE"
systemctl restart smartcam-upload-mini.service >/dev/null 2>&1
systemctl restart smartcam-capture-worker.service >/dev/null 2>&1
systemctl restart smartcam-status-report.timer >/dev/null 2>&1
exit 0
