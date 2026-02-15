#!/bin/sh
set -e
prisma db push --skip-generate --accept-data-loss
exec node custom-server.js
