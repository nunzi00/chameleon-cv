#!/usr/bin/env bash
# Verificación externa de una release publicada (sin sesión gh): uso: verify-release.sh <vX.Y.Z> <repo-para-el-arnés>
set -u
TAG="$1"; REPO="$2"; VER="${TAG#v}"
API="https://api.github.com/repos/nunzi00/chameleon-cv"
IMAGE="ghcr.io/nunzi00/chameleon-cv"
WORK=$(mktemp -d "${TMPDIR:-$HOME/.cache/chameleon-cv-verify}/cv-verify-$VER-XXXX" 2>/dev/null || mktemp -d); cd "$WORK"
IDENTITY="^https://github.com/nunzi00/chameleon-cv/.github/workflows/release.yml@refs/tags/$TAG\$"
ISSUER="https://token.actions.githubusercontent.com"
COSIGN="$HOME/.local/bin/cosign"; command -v cosign >/dev/null && COSIGN=cosign
echo "== 1. Release $TAG"
curl -sf "$API/releases/tags/$TAG" > release.json || { echo "FALLO: release no encontrada"; exit 1; }
python3 - <<PY
import json; r=json.load(open('release.json'))
print('nombre:', r['name'], '| draft:', r['draft'], '| prerelease:', r['prerelease'], '| publicada:', r['published_at'])
for a in r['assets']: print('  asset', a['name'], a['size'], 'bytes')
PY
ASSET="chameleon-cv-$VER-linux-x64.tar.gz"
for f in "$ASSET" "$ASSET.sha256" "SHA256SUMS.txt"; do curl -sfL -o "$f" "https://github.com/nunzi00/chameleon-cv/releases/download/$TAG/$f" || { echo "FALLO descarga $f"; exit 1; }; done
echo "== 2. Huellas"; sha256sum -c "$ASSET.sha256" && grep "$ASSET" SHA256SUMS.txt | sha256sum -c
DIGEST=$(sha256sum "$ASSET" | cut -d' ' -f1); echo "sha256 tar.gz: $DIGEST"
echo "== 3. Binario"; mkdir -p x && tar -xzf "$ASSET" -C x && BIN=$(find x -type f -name cv -perm -u+x | head -1); echo "binario: $BIN"; "$BIN" --version
echo "== 4. Arnés determinista contra el binario descargado (repo: $REPO)"
(cd "$REPO" && CHAMELEON_TYPST=$HOME/.cache/chameleon-cv/typst/0.15.1/typst npm run --silent test:acceptance:deterministic -- --binary "$WORK/$BIN" 2>&1 | grep -aE "^✗|escenarios" | cut -c1-200)
echo "== 5. Imágenes"
for t in "$VER" "$VER-distroless"; do echo "-- $IMAGE:$t"; docker buildx imagetools inspect "$IMAGE:$t" --format '{{ json .Manifest }}' 2>/dev/null | python3 -c "
import json,sys; m=json.load(sys.stdin); print('  digest', m.get('digest')); print('  plataformas', [f\"{x['platform']['os']}/{x['platform']['architecture']}\" for x in m.get('manifests',[]) if x.get('platform',{}).get('os')!='unknown'])"; done
MAJOR="${VER%%.*}"; MINOR="${VER%.*}"
for alias in "$MINOR" "$MAJOR" latest latest-distroless; do printf -- "-- alias %s → " "$alias"; docker buildx imagetools inspect "$IMAGE:$alias" --format '{{ .Manifest.Digest }}' 2>/dev/null || echo "(sin alias)"; done
echo "== 6. Atestaciones SLSA (cosign $($COSIGN version 2>/dev/null | grep -i gitversion | head -1))"
for t in "$VER" "$VER-distroless"; do printf -- "-- imagen %s: " "$t"; $COSIGN verify-attestation "$IMAGE:$t" --type slsaprovenance1 --new-bundle-format --certificate-identity-regexp "$IDENTITY" --certificate-oidc-issuer "$ISSUER" >/dev/null 2>cosign-$t.err && echo "Verified OK" || { echo "FALLO"; tail -2 "cosign-$t.err"; }; done
printf -- "-- tar.gz: "; curl -sf "$API/attestations/sha256:$DIGEST" > att.json && python3 -c "
import json; a=json.load(open('att.json'))['attestations']; json.dump(a[0]['bundle'], open('bundle.json','w')); print(len(a), 'atestación(es) en la API')" && $COSIGN verify-blob-attestation --bundle bundle.json --new-bundle-format --type slsaprovenance1 --certificate-identity-regexp "$IDENTITY" --certificate-oidc-issuer "$ISSUER" "$ASSET" >/dev/null 2>cosign-blob.err && echo "  Verified OK" || { echo "  (aún sin atestación del tar.gz en la API o fallo)"; tail -2 cosign-blob.err 2>/dev/null; }
echo "== 7. Humo de las imágenes publicadas"
(cd "$REPO" && bash scripts/docker-smoke.sh "$IMAGE:$VER" 1000 2>&1 | tail -2 && bash scripts/docker-smoke.sh "$IMAGE:$VER-distroless" 65532 2>&1 | tail -2)
echo "== FIN ($WORK)"
