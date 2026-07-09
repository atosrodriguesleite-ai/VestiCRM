#!/usr/bin/env bash
# Sobe um PostgreSQL local para desenvolvimento/teste (ambientes efêmeros).
# Uso:  bash scripts/dev-postgres.sh
# Depois:  export DATABASE_URL="postgresql://vesti@127.0.0.1:5433/vesticrm?schema=public"
#          npm run db:deploy && npm run db:seed
set -e

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDIR="${PGDIR:-/var/lib/postgresql/vesti}"
PGPORT="${PGPORT:-5433}"

if [ ! -d "$PGDIR/base" ]; then
  echo "→ Inicializando cluster em $PGDIR ..."
  mkdir -p "$PGDIR"
  chown postgres:postgres "$PGDIR"
  chmod 700 "$PGDIR"
  su postgres -c "$PGBIN/initdb -D $PGDIR -U vesti --auth=trust -E UTF8" >/dev/null
fi

if ! su postgres -c "$PGBIN/pg_ctl -D $PGDIR status" >/dev/null 2>&1; then
  echo "→ Iniciando PostgreSQL na porta $PGPORT ..."
  su postgres -c "$PGBIN/pg_ctl -D $PGDIR -o '-p $PGPORT -k /tmp' -l $PGDIR/server.log start"
  sleep 2
fi

if ! su postgres -c "$PGBIN/psql -p $PGPORT -h /tmp -U vesti -lqt" | cut -d'|' -f1 | grep -qw vesticrm; then
  echo "→ Criando banco 'vesticrm' ..."
  su postgres -c "$PGBIN/createdb -p $PGPORT -h /tmp -U vesti vesticrm"
fi

echo "✓ PostgreSQL pronto."
echo '  DATABASE_URL="postgresql://vesti@127.0.0.1:'"$PGPORT"'/vesticrm?schema=public"'
