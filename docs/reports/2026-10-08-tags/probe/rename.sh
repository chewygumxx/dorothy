#!/bin/sh
# Probe editor: keep a copy of what --edit-tags shows, then rename the concept.
cp "$1" /tmp/dorothy-tags-probe.Nrds50/edit-tags-view.md
sed -i 's/^Tag: sourdough starter$/Tag: levain/' "$1"
