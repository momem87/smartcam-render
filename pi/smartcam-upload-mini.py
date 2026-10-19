#!/usr/bin/env python3
import os, time, subprocess, requests

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
UPLOAD_URL = SERVER + "/api/live-upload"
HEADERS = {"x-api-key": CONF.get("API_KEY", "")}
IMG = "/tmp/smartcam-mini.jpg"
PAUSE_FILE = "/tmp/smartcam-capture-pause"

session = requests.Session()
cmd = ["rpicam-still", "-o", IMG, "--roi", "0,0,1,1", "--width", "960", "--height", "720",
       "--timeout", "80", "--nopreview", "--quality", "55", "--awb", "auto",
       "--brightness", "0.05", "--contrast", "1.10", "--saturation", "0.95",
       "--sharpness", "0.8", "--ev", "0.6"]

print("[mini-uploader] started ->", UPLOAD_URL)
while True:
    try:
        if os.path.exists(PAUSE_FILE):
            time.sleep(0.1)
            continue
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        if os.path.exists(IMG) and os.path.getsize(IMG) > 0:
            with open(IMG, "rb") as f:
                r = session.post(UPLOAD_URL, files={"image": f}, headers=HEADERS, timeout=10)
            if r.status_code == 401:
                print("[mini-uploader] 401 Bad API key - check /etc/smartcam.conf")
                time.sleep(5)
        time.sleep(0.05)
    except Exception as e:
        print("[mini-uploader] error:", e)
        time.sleep(0.5)
