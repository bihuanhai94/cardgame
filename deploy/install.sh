#!/usr/bin/env bash
#
# deploy/install.sh
#
# WHERE TO RUN: ON THE TARGET SERVER (119.29.198.188), AS ROOT.
# WHEN TO RUN: after Step 1 (glibc-217 Node verification) has passed, and after
#   the release tarball has already been uploaded to /tmp/cardgame-dist.tar.gz
#   (see deploy/README.md "Build and upload a release").
#
# This script performs ONLY the server-side setup steps that are pure
# additions to the box:
#   - create the unprivileged `cardgame` system user
#   - lay out /opt/cardgame/{app,data,node,logs}
#   - install the verified glibc-217 Node build into /opt/cardgame/node
#     (expects it to already be unpacked at /tmp/node-v22.14.0-linux-x64-glibc-217,
#      per Step 1 of deploy/README.md)
#   - unpack the release tarball into /opt/cardgame/app
#   - install production-only npm dependencies (fastify, ws — pure JS, no
#     native compilation, safe on this gcc 4.8 / glibc 2.17 box)
#   - install and enable the systemd unit
#
# This script deliberately does NOT touch nginx. Wiring nginx is the single
# risky, shared-resource step in this deployment and must be done by hand,
# in the exact backup -> validate -> reload -> verify order documented in
# deploy/README.md.
#
# Safe to read end-to-end before running. No destructive defaults: it will
# not overwrite an existing /opt/cardgame/app deployment without asking,
# and it never deletes data.

set -euo pipefail

NODE_VERSION="v22.14.0"
NODE_SRC_DIR="/tmp/node-${NODE_VERSION}-linux-x64-glibc-217"
RELEASE_TARBALL="/tmp/cardgame-dist.tar.gz"
APP_ROOT="/opt/cardgame"
SERVICE_UNIT_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cardgame.service"
SERVICE_UNIT_DST="/etc/systemd/system/cardgame.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: this script must be run as root." >&2
  exit 1
fi

if [[ ! -f "${RELEASE_TARBALL}" ]]; then
  echo "ERROR: ${RELEASE_TARBALL} not found." >&2
  echo "Upload the release tarball first (see deploy/README.md 'Build and upload a release')." >&2
  exit 1
fi

echo "==> Step: create isolated runtime user + directory layout"
if ! id -u cardgame >/dev/null 2>&1; then
  useradd -r -s /sbin/nologin -d "${APP_ROOT}" cardgame
else
  echo "    user 'cardgame' already exists, skipping useradd"
fi

mkdir -p "${APP_ROOT}"/{app,data,node,logs}

echo "==> Step: install glibc-217 Node into ${APP_ROOT}/node"
if [[ -x "${APP_ROOT}/node/bin/node" ]]; then
  echo "    ${APP_ROOT}/node/bin/node already present, skipping move"
else
  if [[ ! -d "${NODE_SRC_DIR}" ]]; then
    echo "ERROR: ${NODE_SRC_DIR} not found." >&2
    echo "Run Step 1 of deploy/README.md first to download and verify the Node build." >&2
    exit 1
  fi
  mv "${NODE_SRC_DIR}"/* "${APP_ROOT}/node/"
fi
"${APP_ROOT}/node/bin/node" -v

echo "==> Step: unpack release into ${APP_ROOT}/app"
if [[ -d "${APP_ROOT}/app/packages" ]]; then
  echo "    ${APP_ROOT}/app already has a deployment."
  read -r -p "    Overwrite by extracting the new tarball on top? [y/N] " reply
  if [[ ! "${reply}" =~ ^[Yy]$ ]]; then
    echo "    Aborting unpack. Nothing else changed."
    exit 1
  fi
fi
tar xzf "${RELEASE_TARBALL}" -C "${APP_ROOT}/app"

echo "==> Step: install production dependencies (pure JS, no native build)"
cd "${APP_ROOT}/app"
"${APP_ROOT}/node/bin/npm" install --omit=dev --no-audit --no-fund fastify@5 ws@8
if [[ -d "${APP_ROOT}/app/node_modules/.bin" ]] && find "${APP_ROOT}/app/node_modules" -name "*.node" | grep -q .; then
  echo "WARNING: found compiled .node binaries after install — a native module slipped in." >&2
  echo "         Investigate before starting the service; this box cannot compile native addons." >&2
fi

echo "==> Step: fix ownership"
chown -R cardgame:cardgame "${APP_ROOT}"

echo "==> Step: install systemd unit"
cp "${SERVICE_UNIT_SRC}" "${SERVICE_UNIT_DST}"
systemctl daemon-reload
systemctl enable --now cardgame

sleep 2
echo "==> Status:"
systemctl is-active cardgame
echo "==> Note: verify agent-hub's PID is unchanged before/after this run (see deploy/README.md)."
echo "==> nginx has NOT been touched by this script. Do that step by hand next, per deploy/README.md."
