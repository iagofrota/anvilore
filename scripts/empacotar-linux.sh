#!/usr/bin/env bash
# Empacota o Anvilore para Linux (.deb e .rpm) usando nfpm com SHA-256 conferido.
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
exec bun "$raiz/scripts/empacotar-linux.ts" "$@"
