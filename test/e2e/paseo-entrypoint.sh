#!/bin/sh
set -eu

mkdir -p "$PASEO_HOME"
if [ ! -f "$PASEO_HOME/config.json" ]; then
  cp /opt/paseo-semantic-index/test/e2e/paseo-config.json "$PASEO_HOME/config.json"
fi
chown -R 1000:1000 "$PASEO_HOME"
chmod 0600 "$PASEO_HOME/config.json"

exec /usr/local/bin/paseo-docker-entrypoint
