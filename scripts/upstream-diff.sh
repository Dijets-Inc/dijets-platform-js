#!/bin/sh
# Writes UPSTREAM.patch: every change made to the vendored avalanche@3.15.2
# source (src/upstream) and its tests (test/upstream), against the version
# published on npm.
set -eu
cd "$(dirname "$0")/.."
work=$(mktemp -d)
# Remove only the temporary download directory made above.
trap 'rm -rf "$work"' EXIT
(cd "$work" && npm pack avalanche@3.15.2 >/dev/null 2>&1 && tar -xzf avalanche-3.15.2.tgz)
{
  diff -ruN --label upstream/src --label src/upstream "$work/package/src" src/upstream || true
  diff -ruN -x fixture-network.ts "$work/package/tests" test/upstream \
    | sed -E 's#^(---|\+\+\+) [^ ]*/package/tests#\1 upstream/tests#' || true
} > UPSTREAM.patch
grep -c '^diff ' UPSTREAM.patch | xargs echo "files changed:"
