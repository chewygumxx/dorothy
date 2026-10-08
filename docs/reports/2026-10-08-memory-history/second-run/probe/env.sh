# shellcheck shell=sh
# Sourced before each launch: throwaway XDG directories, dotenvx's own
# key, a mirror key of the probe's own, and $B, bun run directly.
export P=/tmp/dorothy-history-probe2.dPHCX4
export XDG_DATA_HOME=$P/data XDG_CACHE_HOME=$P/cache XDG_CONFIG_HOME=$P/config DOTENVX_CONFIG="$HOME/.config/dotenvx"
export DOROTHY_MIRROR_KEY='<32 random bytes, base64>'
unset FORCE_COLOR
export B=/home/chewygumxx/.local/share/mise/installs/bun/1.4/bin/bun
cd /home/chewygumxx/dev/dorothy || return
