#!/usr/bin/env bash
# Prueba de humo de la imagen Docker (T-7.2, docs/docker.md §7): la imagen debe comportarse como el ejecutable
# —con un volumen montado, como usuario sin privilegios y endurecida— y el espacio de red compartido con un
# doble de Ollama en loopback (lo que compose.ai.yml hace con network_mode: service:ollama) debe alcanzarlo.
#   npm run docker:smoke                      # imagen chameleon-cv:local, propietario esperado = tu UID
#   bash scripts/docker-smoke.sh <imagen> [uid-esperado]
set -euo pipefail
IMAGE="${1:-chameleon-cv:local}"
EXPECTED_UID="${2:-$(id -u)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OFFER="$ROOT/tests/acceptance/bench/workspace/offers/nexo-senior-backend.txt"
BUSYBOX="busybox:1.37@sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0"
WORK="$(mktemp -d)"
VOLUME="cv-smoke-$$"
STANDIN="cv-smoke-ollama-$$"
cleanup() {
  docker rm -f "$STANDIN" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  rm -rf "$WORK" 2>/dev/null || docker run --rm -v "$WORK:/w" --entrypoint sh "$IMAGE" -c 'rm -rf /w/* /w/.[!.]*' >/dev/null 2>&1 || true
}
trap cleanup EXIT
pass() { printf '  ✓ %s\n' "$1"; }
fail() { printf '  ✗ %s\n' "$1" >&2; exit 1; }
run() { docker run --rm -v "$WORK:/work" "$IMAGE" "$@"; }

echo "▸ Prueba de humo de la imagen $IMAGE (propietario esperado de los ficheros: $EXPECTED_UID)"
version="$(run --version)"
[ -n "$version" ] || fail "cv --version no imprime nada"
if command -v node >/dev/null 2>&1; then
  expected="$(node -p "require('$ROOT/package.json').version")"
  [ "$version" = "$expected" ] || fail "cv --version imprime $version y package.json dice $expected"
fi
pass "cv --version = $version"
run init >/dev/null && pass "cv init"
run build && pass "cv build"
run generate-cv -s backend -o output/cv.md >/dev/null && [ -f "$WORK/output/cv.md" ] && pass "generate-cv (Markdown)"
run generate-cv -s backend --format pdf -o output/pdfkit.pdf >/dev/null && pass "generate-cv (pdfkit)"
run typst status >/dev/null && pass "typst status: Typst viaja en la imagen"
run generate-cv -s backend --format pdf --engine typst --theme classic -o output/typst.pdf >/dev/null && pass "generate-cv (Typst, tema classic)"
docker run --rm -i -v "$WORK:/work" "$IMAGE" analyze-offer - < "$OFFER" >/dev/null && pass "analyze-offer por la entrada estándar"
docker run --rm -i -v "$WORK:/work" "$IMAGE" generate-cv -f - --compact -o output/oferta.md < "$OFFER" >/dev/null && pass "generate-cv -f - --compact por la entrada estándar"
owner="$(stat -c %u "$WORK/data/dist/profile.json")"; mode="$(stat -c %a "$WORK/data/dist/profile.json")"
[ "$owner" = "$EXPECTED_UID" ] && [ "$mode" = "600" ] && pass "el artefacto es del usuario $owner con permisos 0600" || fail "propiedad o permisos inesperados: $owner $mode"
docker run --rm --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges --network none -v "$WORK:/work" -v "$VOLUME:/home/cv/.cache" "$IMAGE" generate-cv -s backend --format pdf --engine typst -o output/hardened.pdf >/dev/null \
  && pass "ejecución endurecida (raíz de solo lectura, sin capacidades, sin red, caché en volumen con nombre)"
if docker run --rm --network none -v "$WORK:/work" "$IMAGE" llm status >/dev/null 2>&1; then fail "llm status sin red debería terminar con código 2"; else pass "llm status sin red: no hay proveedor (código 2)"; fi
mkdir -p "$WORK/stand-in/api"
printf '{"version":"0.33.2"}' > "$WORK/stand-in/api/version"
printf '{"models":[{"name":"qwen2.5:7b-instruct","model":"qwen2.5:7b-instruct"}]}' > "$WORK/stand-in/api/tags"
docker run -d --name "$STANDIN" -v "$WORK/stand-in:/srv:ro" "$BUSYBOX" httpd -f -p 127.0.0.1:11434 -h /srv >/dev/null
sleep 1
docker run --rm --network "container:$STANDIN" -v "$WORK:/work" "$IMAGE" llm status | grep -q 'alcanzable' \
  && pass "espacio de red compartido: el doble de Ollama en 127.0.0.1:11434 es alcanzable (network_mode: service:ollama)"
echo "Humo de la imagen: todo en verde"
