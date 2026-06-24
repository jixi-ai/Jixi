#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

npm version minor --no-git-tag-version
npm run build
npm publish
