# shellcheck shell=sh
# Sourced before each launch: throwaway XDG directories, dotenvx's own
# key, a mirror key of the probe's own, and $B, bun run directly.
export XDG_DATA_HOME=/tmp/dorothy-history-probe.c0HYLK/data XDG_CACHE_HOME=/tmp/dorothy-history-probe.c0HYLK/cache XDG_CONFIG_HOME=/tmp/dorothy-history-probe.c0HYLK/config DOTENVX_CONFIG="$HOME/.config/dotenvx"
export DOROTHY_MIRROR_KEY='<32 random bytes, base64>'
unset FORCE_COLOR
export B=/home/chewygumxx/.local/share/mise/installs/bun/1.4/bin/bun
cd /home/chewygumxx/dev/dorothy || return
