#!/usr/bin/env python3
import json, re, subprocess, time, urllib.request

def load_conf(path="/etc/smartcam.conf"):
    conf = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                conf[k.strip()] = v.strip().strip('"')
    return conf

CONF = load_conf()
SERVER = CONF["SERVER"].rstrip("/")
URL = SERVER + "/api/pi-status"
PING_URL = SERVER + "/api/ping"
API_KEY = CONF.get("API_KEY", "")
IFACE = "wlan0"

def run(cmd, timeout=5):
    try:
        return subprocess.check_output(cmd, shell=True, stderr=subprocess.DEVNULL, timeout=timeout, text=True).strip()
    except Exception:
        return ""

def get_temperature():
    m = re.search(r"temp=([0-9.]+)", run("vcgencmd measure_temp"))
    if m:
        v = float(m.group(1))
        return v, f"{v:.1f}°C"
    return None, None

def get_latency():
    # قياس زمن الاستجابة الفعلي للسيرفر عبر HTTP (Render مابيردش على ping)
    samples = []
    for _ in range(3):
        try:
            t = time.time()
            urllib.request.urlopen(PING_URL, timeout=6).read()
            samples.append((time.time() - t) * 1000)
        except Exception:
            pass
    return round(sum(samples) / len(samples), 1) if samples else None

def get_wifi():
    out = run(f"iw dev {IFACE} link")
    ssid = signal_dbm = None
    m = re.search(r"SSID:\s*(.+)", out)
    if m: ssid = m.group(1).strip()
    m = re.search(r"signal:\s*(-?\d+)", out)
    if m: signal_dbm = int(m.group(1))
    if not ssid:
        ssid = run("nmcli -t -f active,ssid dev wifi | awk -F: '$1==\"yes\"{print $2; exit}'") or None
    if signal_dbm is None: quality = "N/A"
    elif signal_dbm >= -50: quality = "Excellent"
    elif signal_dbm >= -60: quality = "Very Good"
    elif signal_dbm >= -70: quality = "Good"
    elif signal_dbm >= -80: quality = "Weak"
    else: quality = "Very Weak"
    return ssid, signal_dbm, quality

temp_c, temp_text = get_temperature()
ssid, signal_dbm, signal_quality = get_wifi()
payload = {
    "local_ip": run("hostname -I | awk '{print $1}'") or None,
    "ssid": ssid, "temperature_c": temp_c, "temperature": temp_text,
    "latency_ms": get_latency(), "signal_dbm": signal_dbm, "signal_quality": signal_quality,
}
req = urllib.request.Request(URL, data=json.dumps(payload).encode(),
                             headers={"Content-Type": "application/json", "x-api-key": API_KEY}, method="POST")
print("payload=", json.dumps(payload, ensure_ascii=False))
print(urllib.request.urlopen(req, timeout=15).read().decode())
