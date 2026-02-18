#!/bin/sh
set -e

# Replace build-time placeholders with real env values in client-side JS bundles
find .next -type f -name "*.js" -exec sed -i \
  -e "s|__NEXT_PUBLIC_SUPABASE_URL__|${NEXT_PUBLIC_SUPABASE_URL}|g" \
  -e "s|__NEXT_PUBLIC_SUPABASE_ANON_KEY__|${NEXT_PUBLIC_SUPABASE_ANON_KEY}|g" \
  {} +

npx node-pg-migrate up --migrations-dir migrations --database-url-var DATABASE_URL
exec node custom-server.js
