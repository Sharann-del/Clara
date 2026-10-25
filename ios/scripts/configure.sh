#!/bin/sh
# Writes Clara/Resources/ClaraConfig.json (gitignored) from the web app's env, so the iOS app
# talks to the same API, WebSocket and Cognito pool. Re-run after a deploy that changes any of
# them. Config/ClaraConfig.example.json shows the format.
set -e
cd "$(dirname "$0")/.."
ENV=../packages/frontend/.env
if [ ! -f "$ENV" ]; then
  echo "error: $ENV not found. Copy packages/frontend/.env.example to .env and fill it in from the stack outputs." >&2
  exit 1
fi
get() { grep "^$1=" "$ENV" | head -1 | cut -d= -f2-; }
INVITE=false
[ "$(get VITE_SIGNUP_INVITE_REQUIRED)" = "true" ] && INVITE=true
cat > Clara/Resources/ClaraConfig.json <<JSON
{
  "apiUrl": "$(get VITE_API_URL)",
  "wsUrl": "$(get VITE_WS_URL)",
  "userPoolId": "$(get VITE_USER_POOL_ID)",
  "userPoolClientId": "$(get VITE_USER_POOL_CLIENT_ID)",
  "region": "$(get VITE_AWS_REGION)",
  "siteUrl": "$(get VITE_SITE_URL)",
  "signupInviteRequired": $INVITE
}
JSON
echo "wrote Clara/Resources/ClaraConfig.json"
