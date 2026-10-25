#!/bin/sh
# Writes Clara/Resources/ClaraConfig.json from the web app's env (same API, WebSocket and
# Cognito pool). Re-run after a deploy that changes any of them.
set -e
cd "$(dirname "$0")/.."
ENV=../packages/frontend/.env
get() { grep "^$1=" "$ENV" | head -1 | cut -d= -f2-; }
cat > Clara/Resources/ClaraConfig.json <<JSON
{
  "apiUrl": "$(get VITE_API_URL)",
  "wsUrl": "$(get VITE_WS_URL)",
  "userPoolId": "$(get VITE_USER_POOL_ID)",
  "userPoolClientId": "$(get VITE_USER_POOL_CLIENT_ID)",
  "region": "$(get VITE_AWS_REGION)",
  "siteUrl": "$(get VITE_SITE_URL)"
}
JSON
echo "wrote Clara/Resources/ClaraConfig.json"
