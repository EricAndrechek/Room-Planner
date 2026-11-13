#!/bin/sh
# Optional: upload source maps to PostHog error tracking after `astro build`.
# A no-op unless POSTHOG_CLI_API_KEY is set (a build secret in Cloudflare Workers Builds).
# Also needed: POSTHOG_CLI_PROJECT_ID (build variable); POSTHOG_CLI_HOST defaults to US cloud.
# API key: personal key with "error tracking write" + "organization read" scopes.
set -eu

if [ -z "${POSTHOG_CLI_API_KEY:-}" ] || [ -z "${POSTHOG_CLI_PROJECT_ID:-}" ]; then
  echo "upload-sourcemaps: POSTHOG_CLI_API_KEY / POSTHOG_CLI_PROJECT_ID not set, skipping."
  exit 0
fi

version="${WORKERS_CI_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
cli="npx --yes @posthog/cli"
$cli sourcemap inject --directory dist
$cli sourcemap upload --directory dist --release-name room-planner --release-version "$version"
