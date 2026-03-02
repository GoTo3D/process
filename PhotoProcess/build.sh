#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Building PhotoProcess..."
swift build -c release

# CR-09: Verify binary was produced
test -f .build/release/PhotoProcess || { echo "ERROR: Build failed - binary not found"; exit 1; }

DEST="../src/lib/PhotoProcess"

# CR-15: Backup previous binary
if [ -f "$DEST" ]; then
    cp "$DEST" "$DEST.bak"
    echo "Backed up previous binary to $DEST.bak"
fi

cp .build/release/PhotoProcess "$DEST"
chmod +x "$DEST"
echo "Built and deployed PhotoProcess to $DEST"
