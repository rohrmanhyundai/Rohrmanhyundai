#!/bin/bash
# Put the AWS keys into the worker from the CSV the IAM console downloads
# ("Download .csv file" on the Retrieve access keys page). Copy/paste of the
# secret proved unreliable; this reads the file, uploads both values and then
# deletes it. Nothing is printed but the lengths.
set -euo pipefail
cd "$(dirname "$0")/.."

CSV=$(ls -t ~/Downloads/*ccessKeys*.csv 2>/dev/null | head -1 || true)
[ -n "$CSV" ] || { echo "No accessKeys CSV in ~/Downloads — click 'Download .csv file' on the AWS page first."; exit 1; }
echo "Reading $CSV"

ROW=$(tail -1 "$CSV" | tr -d '\r')
KEY_ID=$(printf '%s' "$ROW" | cut -d, -f1)
SECRET=$(printf '%s' "$ROW" | cut -d, -f2)
echo "key id: ${#KEY_ID} chars (expect 20) · secret: ${#SECRET} chars (expect 40)"
[ ${#KEY_ID} -eq 20 ] && [ ${#SECRET} -eq 40 ] || { echo "That CSV doesn't look right — aborting, nothing uploaded."; exit 1; }

printf '%s' "$KEY_ID" | npx wrangler secret put AWS_ACCESS_KEY_ID
printf '%s' "$SECRET" | npx wrangler secret put AWS_SECRET_ACCESS_KEY

rm -P "$CSV" 2>/dev/null || rm -f "$CSV"
echo "✅ Both keys uploaded and $CSV deleted."
