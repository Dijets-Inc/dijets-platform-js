#!/bin/sh
# Regenerates test/vectors/*.json from a dijetsnodesgo checkout, so the tests
# compare the library against the node's own implementation.
#   DIJETSNODESGO=/path/to/dijetsnodesgo ./scripts/vectors.sh
set -eu
: "${DIJETSNODESGO:?set DIJETSNODESGO to a dijetsnodesgo checkout}"
cd "$(dirname "$0")/.."
mkdir -p test/vectors
commit=$(git -C "$DIJETSNODESGO" rev-parse --short HEAD 2>/dev/null || echo unknown)
for set in networks addresses names txs; do
  tools/vectors/run.sh golden "$set" > "test/vectors/$set.json"
  echo "test/vectors/$set.json"
done
printf '{ "dijetsnodesgo": "%s" }\n' "$commit" > test/vectors/source.json
