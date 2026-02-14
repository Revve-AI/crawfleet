#!/bin/sh
set -e
prisma db push --skip-generate
exec node server.js
