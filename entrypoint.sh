#!/bin/sh
set -e
npx node-pg-migrate up --migrations-dir migrations --database-url-var DATABASE_URL
exec node custom-server.js
