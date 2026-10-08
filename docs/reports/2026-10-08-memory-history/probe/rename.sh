#!/bin/sh
# Probe editor: keep a copy of what --edit-tags shows, then rename the concept.
cp "$1" /tmp/dorothy-history-probe.c0HYLK/edit-tags-view.md
sed -i 's/^Tag: houseplant care$/Tag: indoor plants/' "$1"
