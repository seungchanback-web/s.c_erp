#!/bin/sh
set -e

# DB가 없으면 초기화
if [ ! -f "$DATA_DIR/orders.db" ]; then
  echo "orders.db not found, initializing..."
  node init_db.js
fi

exec "$@"
