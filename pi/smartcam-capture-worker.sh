#!/bin/bash
source /etc/smartcam.conf
SERVER="${SERVER%/}"
REQ_URL="$SERVER/api/capture-request"
UPLOAD_URL="$SERVER/api/capture-upload"
PHASE_URL="$SERVER/api/capture-phase"
HD_IMG="/tmp/smartcam-hd.jpg"
PAUSE_FILE="/tmp/smartcam-capture-pause"
AUTH=(-H "x-api-key: $API_KEY")
LAST_ID=""

set_phase() {
  curl -s --max-time 5 -X POST "$PHASE_URL" "${AUTH[@]}" \
    -H "Content-Type: application/json" \
    -d "{\"phase\":\"$1\",\"message\":\"$2\"}" >/dev/null
}

capture_args_for_preset() {
  case "$PRESET" in
    screen)
      echo "--roi 0,0,1,1 --width 2592 --height 1944 --timeout 200 --nopreview --quality 95 --awb auto --brightness 0.00 --contrast 1.00 --saturation 0.95 --sharpness 0.8 --ev -0.3" ;;
    low_light)
      echo "--roi 0,0,1,1 --width 2592 --height 1944 --timeout 300 --nopreview --quality 95 --awb auto --brightness 0.08 --contrast 1.10 --saturation 1.05 --sharpness 0.8 --ev 0.8" ;;
    warm)
      echo "--roi 0,0,1,1 --width 2592 --height 1944 --timeout 250 --nopreview --quality 95 --awb cloudy --brightness 0.06 --contrast 1.10 --saturation 1.12 --sharpness 0.8 --ev 0.6" ;;
    original|*)
      echo "--roi 0,0,1,1 --width 2592 --height 1944 --timeout 200 --nopreview --quality 95 --awb auto --brightness 0.06 --contrast 1.10 --saturation 0.95 --sharpness 0.8 --ev 0.6" ;;
  esac
}

echo "[capture-worker] started -> $SERVER"
while true; do
  RESP="$(curl -s --max-time 8 "${AUTH[@]}" "$REQ_URL")"
  REQUESTED="$(echo "$RESP" | grep -o '"requested":[^,}]*' | cut -d: -f2 | tr -d ' ')"
  REQUEST_ID="$(echo "$RESP" | grep -o '"request_id":"[^"]*"' | cut -d'"' -f4)"
  PRESET="$(echo "$RESP" | grep -o '"preset":"[^"]*"' | cut -d'"' -f4)"
  [ -z "$PRESET" ] && PRESET="original"

  if [ "$REQUESTED" = "true" ] && [ -n "$REQUEST_ID" ] && [ "$REQUEST_ID" != "$LAST_ID" ]; then
    LAST_ID="$REQUEST_ID"
    echo "[capture-worker] request id=$REQUEST_ID preset=$PRESET"
    set_phase "requested" "Capture request received: $PRESET"
    touch "$PAUSE_FILE"
    sleep 0.25
    CAPTURE_ARGS="$(capture_args_for_preset)"
    set_phase "capturing" "Taking HD capture: $PRESET"
    START_MS=$(date +%s%3N)
    rm -f "$HD_IMG"
    rpicam-still -o "$HD_IMG" $CAPTURE_ARGS >/dev/null 2>&1
    AFTER_CAPTURE_MS=$(date +%s%3N)
    if [ -s "$HD_IMG" ]; then
      echo "[capture-worker] captured size=$(stat -c%s "$HD_IMG") bytes"
      set_phase "uploading" "Uploading HD capture: $PRESET"
      curl -s --max-time 40 -X POST "${AUTH[@]}" -F "image=@$HD_IMG" "$UPLOAD_URL" >/dev/null
      AFTER_UPLOAD_MS=$(date +%s%3N)
      echo "[capture-worker] upload took $((AFTER_UPLOAD_MS-AFTER_CAPTURE_MS)) ms, total $((AFTER_UPLOAD_MS-START_MS)) ms"
      set_phase "done" "Done: $PRESET"
    else
      set_phase "error" "Camera capture failed: $PRESET"
      echo "[capture-worker] ERROR: capture failed preset=$PRESET"
    fi
    rm -f "$PAUSE_FILE"
  fi
  sleep 0.5
done
