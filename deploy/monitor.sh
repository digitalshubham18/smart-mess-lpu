#!/usr/bin/env bash
# A tiny "is it healthy?" check you can run from ANOTHER machine's cron every 5 minutes (a monitor that lives on the
# server it watches can't tell you the server is down). Exits non-zero and prints the reason when something is wrong;
# pipe that to mail/Slack/etc:   */5 * * * * /opt/monitor.sh https://mess.example.edu || echo "Smart Mess check failed" | mail -s ALERT you@example.edu
#
# /api/health/ready is 503 when the database doesn't answer OR the newest backup is older than BACKUP_MAX_AGE_HOURS (36).
set -uo pipefail
base="${1:?usage: monitor.sh https://your.hostname}"
code="$(curl -sS -o /tmp/smartmess-health.json -w '%{http_code}' --max-time 15 "$base/api/health/ready" || echo 000)"
if [ "$code" != "200" ]; then echo "Smart Mess UNHEALTHY (HTTP $code): $(cat /tmp/smartmess-health.json 2>/dev/null)"; exit 1; fi
# Certificate expiring? Caddy renews at 30 days; under 14 means renewal is failing.
host="${base#https://}"; host="${host%%/*}"
end="$(echo | openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
if [ -n "$end" ]; then
  days=$(( ( $(date -d "$end" +%s) - $(date +%s) ) / 86400 ))
  [ "$days" -ge 14 ] || { echo "Smart Mess TLS certificate expires in $days days"; exit 1; }
fi
echo "ok"
