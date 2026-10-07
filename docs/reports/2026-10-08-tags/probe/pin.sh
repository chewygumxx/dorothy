#!/bin/sh
# Probe editor: hold the --memory view open while a review runs, then pin.
cp "$1" /tmp/dorothy-tags-probe.Nrds50/memory-view-before.md
sleep 50
sed -i 's/^Pinned: .*/Pinned: yes/' "$1"
cp "$1" /tmp/dorothy-tags-probe.Nrds50/memory-view-saved.md
