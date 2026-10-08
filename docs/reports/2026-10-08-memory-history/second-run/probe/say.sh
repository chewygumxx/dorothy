#!/bin/sh
# say.sh "message": type into the chat's window (0, whichever window is
# active), then wait for the reply to finish.
tmux send-keys -t historyprobe:0 -l "$1"
tmux send-keys -t historyprobe:0 Enter
sleep 5
for _ in $(seq 1 40); do
    s=$(tmux capture-pane -p -t historyprobe:0 | grep -v "^$" | tail -1)
    case "$s" in *ready* | *idle* | *disconnected*) break ;; esac
    sleep 3
done
tmux capture-pane -p -t historyprobe:0 -S -200 | grep -v '^$' | tail -"${2:-30}"
