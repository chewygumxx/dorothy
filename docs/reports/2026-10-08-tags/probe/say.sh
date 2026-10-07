#!/bin/sh
# say.sh "message": type into the tmux TUI, then wait for the reply to finish.
tmux send-keys -t tagsprobe -l "$1"; tmux send-keys -t tagsprobe Enter
sleep 5
for i in $(seq 1 40); do
  s=$(tmux capture-pane -p -t tagsprobe | tail -1)
  case "$s" in *ready*|*idle*|*disconnected*) break;; esac
  sleep 3
done
tmux capture-pane -p -t tagsprobe -S -200 | grep -v '^$' | tail -${2:-30}
