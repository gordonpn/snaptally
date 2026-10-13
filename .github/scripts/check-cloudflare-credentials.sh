#!/usr/bin/env bash
set -euo pipefail

if [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  echo "configured=true" >> "$GITHUB_OUTPUT"
else
  echo "configured=false" >> "$GITHUB_OUTPUT"
  if [ "${GITHUB_EVENT_NAME:-}" = "push" ]; then
    echo "::error::CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required for production deployment"
    exit 1
  else
    echo "::warning::Cloudflare credentials are not configured; skipping preview deployment"
  fi
fi
