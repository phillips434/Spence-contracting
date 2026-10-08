#!/bin/sh
# Restore rehearsal for synthetic staging only. Keeps the restored copy for review.
set -eu
[ "$PGDATABASE" = contractor_beta ]
actual=$(psql -Atqc 'select current_database()')
[ "$actual" = contractor_beta ]
restore_db=contractor_beta_restore_$(date +%s)
pg_dump --format=custom --no-owner --no-acl --file=/tmp/beta.dump
createdb "$restore_db"
pg_restore --no-owner --no-acl --exit-on-error --dbname="$restore_db" /tmp/beta.dump
psql -Atqc "select table_name from information_schema.tables where table_schema='public' order by table_name" > /tmp/beta-tables
while IFS= read -r table; do
 case "$table" in *[!a-z0-9_]*) exit 2;; esac
 sql="select count(*)::text || ':' || md5(coalesce(string_agg(to_jsonb(t)::text,chr(10) order by to_jsonb(t)::text),'')) from \"$table\" t"
 before=$(psql -Atqc "$sql")
 after=$(PGDATABASE="$restore_db" psql -Atqc "$sql")
 [ "$before" = "$after" ] || { echo "RESTORE MISMATCH: $table"; exit 3; }
 echo "RESTORE PASS: $table"
done < /tmp/beta-tables
echo "RESTORE COMPLETE: all public table counts and full-row fingerprints match. Synthetic staging database only."
