#!/bin/bash
# تثبيت/تحديث SmartCam على الـ Raspberry Pi وربطه بسيرفر Render
# الاستخدام:  sudo bash install-pi.sh https://اسم-موقعك.onrender.com  API_KEY
set -e
[ "$(id -u)" -eq 0 ] || { echo "شغّل السكربت بـ sudo"; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"

SERVER="${1:-}"; API_KEY="${2:-}"
[ -z "$SERVER" ] && read -rp "رابط Render (مثال https://smartcam-xxxx.onrender.com): " SERVER
[ -z "$API_KEY" ] && read -rp "API_KEY (من Environment في Render، سيبه فاضي لو مش مستخدمه): " API_KEY
SERVER="${SERVER%/}"
case "$SERVER" in https://*|http://*) ;; *) echo "الرابط لازم يبدأ بـ https://"; exit 1;; esac

echo "[1/5] تثبيت الحزم..."
apt update
apt install -y curl python3 python3-requests wireless-tools iw network-manager rpicam-apps libraspberrypi-bin

echo "[2/5] كتابة الإعدادات في /etc/smartcam.conf"
cat > /etc/smartcam.conf <<CONF
SERVER=$SERVER
API_KEY=$API_KEY
CONF
chmod 600 /etc/smartcam.conf

echo "[3/5] نسخ السكربتات والخدمات..."
install -m 755 "$DIR"/smartcam-*.py "$DIR"/smartcam-*.sh /usr/local/bin/
install -m 644 "$DIR"/systemd/*.service "$DIR"/systemd/*.timer /etc/systemd/system/

echo "[4/5] إيقاف توفير الطاقة للواي فاي..."
iw dev wlan0 set power_save off 2>/dev/null || true
cat > /etc/NetworkManager/conf.d/wifi-powersave-off.conf <<NM
[connection]
wifi.powersave = 2
NM

echo "[5/5] تشغيل الخدمات..."
systemctl daemon-reload
systemctl enable smartcam-upload-mini.service smartcam-capture-worker.service smartcam-shutdown-worker.service \
                 smartcam-status-report.timer smartcam-wifi-watchdog.timer
systemctl restart NetworkManager 2>/dev/null || true
systemctl restart smartcam-upload-mini.service smartcam-capture-worker.service smartcam-shutdown-worker.service \
                  smartcam-status-report.timer smartcam-wifi-watchdog.timer

echo
echo "تمام. اختبار الاتصال بالسيرفر:"
curl -s --max-time 60 "$SERVER/api/ping" && echo
echo "تابع اللوج:  journalctl -u smartcam-upload-mini.service -f"
