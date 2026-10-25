#!/usr/bin/env bash
set -euo pipefail
release_dir="$(cd -- "$(dirname -- "$0")/.." && pwd)"
root="${LUDO_ROOT:-$HOME/ludo}"
port="${1:-3011}"
name=ludo-club-staging
[[ "$port" =~ ^[0-9]+$ ]] && ((port>=1024 && port<=65535)) || { echo 'Invalid port' >&2; exit 1; }
mkdir -p "$root/shared/data" "$root/releases"
chmod 700 "$root/shared" "$root/shared/data"
if [[ -e "$root/current" && ! -L "$root/current" ]]; then echo 'current is not a managed symlink; refusing to replace it' >&2; exit 1; fi
gateway="$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')"
python3 - "$root/shared/ludo.env" "$gateway" <<'PY'
from pathlib import Path
import secrets,sys,os
p=Path(sys.argv[1])
if not p.exists():
    p.write_text('\n'.join([
      'NODE_ENV=production','HOST=0.0.0.0','PORT=3000','DB_PATH=/data/ludo.sqlite','BACKUP_DIR=/data/backups',
      'PUBLIC_ROOMS_ENABLED=false','BOT_DIFFICULTY=10','AI_SEARCH_ITERATIONS=96','AI_SEARCH_DEPTH=24','AI_SEARCH_MS=120','ALLOWED_ORIGINS=https://ludo.octu.online','ADMIN_TOKEN='+secrets.token_hex(32),
      'TRUST_PROXY_CIDRS=loopback,'+sys.argv[2]+'/32','MAX_ROOMS=500','MAX_CONNECTIONS=1000',
      'MAX_GUEST_CONNECTIONS=4','MAX_IP_CONNECTIONS=80','MAX_VOICE_BYTES=268435456',
      'MAX_DATABASE_BYTES=1073741824','VOICE_RETENTION_MS=86400000','BACKUP_INTERVAL_MS=21600000'])+'\n')
os.chmod(p,0o600)
PY
if docker container inspect "$name" >/dev/null 2>&1; then
  [[ "$(docker inspect --format '{{index .Config.Labels "io.ludo.managed"}}' "$name")" == true ]] || { echo 'Container name belongs to another service' >&2; exit 1; }
fi
image="ludo-club:stage-$(date -u +%Y%m%d%H%M%S)"
docker build --label io.ludo.managed=true -t "$image" "$release_dir"
previous=''
if docker container inspect "$name" >/dev/null 2>&1; then
  previous="$(docker inspect --format '{{.Config.Image}}' "$name")"
  if [[ "$(docker inspect --format '{{.State.Running}}' "$name")" == true ]]; then docker exec "$name" node scripts/backup.mjs; fi
  docker stop --time 30 "$name" >/dev/null
  docker rm "$name" >/dev/null
fi
start(){
  docker run -d --name "$name" --label io.ludo.managed=true --label "io.ludo.release=$(basename "$release_dir")" \
    --restart unless-stopped --stop-timeout 30 --init --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true --memory 768m --cpus 1.5 \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m --env-file "$root/shared/ludo.env" \
    -v "$root/shared/data:/data" -p "127.0.0.1:$port:3000" "$1" >/dev/null
}
healthy(){ for attempt in $(seq 1 45); do if curl --silent --fail --max-time 2 "http://127.0.0.1:$port/readyz" >/dev/null; then return 0; fi; sleep 1; done; return 1; }
start "$image"
if ! healthy; then
  docker logs --tail 35 "$name" >&2
  docker stop --time 30 "$name" >/dev/null || true
  docker rm "$name" >/dev/null
  if [[ -n "$previous" ]]; then start "$previous"; healthy || true; fi
  echo 'New staging version failed readiness; previous image was restored when available.' >&2
  exit 1
fi
printf '%s\n' "$image" > "$root/shared/current-image"
if [[ -n "$previous" ]]; then printf '%s\n' "$previous" > "$root/shared/previous-image"; fi
ln -sfn "$release_dir" "$root/current"
printf 'STAGING_READY port=%s directory=%s image=%s\n' "$port" "$release_dir" "$image"
