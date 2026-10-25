#!/bin/sh
# Runs the vector generator against a local dijetsnodesgo checkout.
#   DIJETSNODESGO=/path/to/dijetsnodesgo ./run.sh golden
set -eu
: "${DIJETSNODESGO:?set DIJETSNODESGO to a dijetsnodesgo checkout}"
cd "$(dirname "$0")"
work=$(mktemp -d)
# Remove only the temporary go.work directory made above.
trap 'rm -rf "$work"' EXIT
cat > "$work/go.work" <<WORK
go 1.18
use $(pwd)
use $DIJETSNODESGO
WORK
GOWORK="$work/go.work" go run . "$@"
