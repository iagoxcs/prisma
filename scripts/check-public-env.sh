#!/usr/bin/env bash
# Trava do deploy: tudo que é NEXT_PUBLIC_* vai para o JS do site, visível a qualquer visitante.
# Falha se a URL não for do Supabase ou se a chave for secreta (sb_secret_ / JWT service_role).
#   bash scripts/check-public-env.sh          → confere as variáveis antes do build
#   bash scripts/check-public-env.sh out      → confere também o build pronto em ./out
# Nunca imprime o valor da chave.
set -euo pipefail

fail() { echo "::error::$1"; exit 1; }

url="${NEXT_PUBLIC_SUPABASE_URL:-}"
key="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}"

[ -n "$url" ] || fail "NEXT_PUBLIC_SUPABASE_URL vazia"
[ -n "$key" ] || fail "NEXT_PUBLIC_SUPABASE_ANON_KEY vazia"

[[ "$url" =~ ^https://[a-z0-9]+\.supabase\.co/?$ ]] \
  || fail "NEXT_PUBLIC_SUPABASE_URL deve ser https://<project-ref>.supabase.co (recebido: $url)"

case "$key" in
  sb_secret_*)
    fail "NEXT_PUBLIC_SUPABASE_ANON_KEY é uma chave SECRETA (sb_secret_). Use a chave publishable e revogue a secreta no Supabase." ;;
  sb_publishable_*) ;;
  eyJ*)
    # Chave antiga (JWT): o papel precisa ser anon. Decodifica só o payload (base64url).
    payload=$(printf %s "$key" | cut -d. -f2 | tr '_-' '/+')
    while [ $(( ${#payload} % 4 )) -ne 0 ]; do payload="$payload="; done
    role=$(printf %s "$payload" | base64 -d 2>/dev/null | grep -oE '"role" *: *"[a-z_]+"' | grep -oE '[a-z_]+"$' | tr -d '"' || true)
    [ "$role" = "anon" ] || fail "NEXT_PUBLIC_SUPABASE_ANON_KEY é um JWT com papel '${role:-desconhecido}'; só 'anon' pode ir para o site." ;;
  *)
    fail "NEXT_PUBLIC_SUPABASE_ANON_KEY não parece uma chave do Supabase (esperado sb_publishable_... ou JWT anon)." ;;
esac

if [ -n "${1:-}" ]; then
  dir="$1"
  [ -d "$dir" ] || fail "pasta $dir não existe"
  if grep -rqE 'sb_secret_[A-Za-z0-9_-]{8}' "$dir"; then
    fail "O build em $dir contém uma chave secreta (sb_secret_). Publicação cancelada."
  fi
fi

echo "Variáveis públicas do Supabase OK."
