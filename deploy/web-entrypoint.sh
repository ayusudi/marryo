#!/bin/sh
set -eu
cd /app
exec node web/server.js
