#!/usr/bin/env bash
# Copies the newest database backup OFF this machine, encrypted. A backup next to the database dies with the disk.
#
# Needs: `age` (https://age-encryption.org) and `rclone` (https://rclone.org), configured once:
#   age-keygen -o ~/smartmess-backup.key            # KEEP THIS FILE SAFE, OFF this server — without it the backups are unreadable
#   rclone config                                   # create a remote, e.g. "offsite" (S3, Google Drive, SFTP to another host…)
# Then set below (or in the environment) and run daily right after the backup:
#   AGE_RECIPIENT = the PUBLIC key printed by age-keygen ("age1…")   ·   RCLONE_REMOTE = e.g. offsite:smartmess-backups
#
# Docker:   BACKUP_SRC=$(docker volume inspect smartmess_smartmess-data -f '{{.Mountpoint}}')/backups ./offsite-backup.sh
# systemd:  default BACKUP_SRC below
set -euo pipefail
BACKUP_SRC="${BACKUP_SRC:-/srv/smart-mess/server/backups}"
AGE_RECIPIENT="${AGE_RECIPIENT:?set AGE_RECIPIENT to your age public key (age1...)}"
RCLONE_REMOTE="${RCLONE_REMOTE:?set RCLONE_REMOTE, e.g. offsite:smartmess-backups}"
KEEP_REMOTE_DAYS="${KEEP_REMOTE_DAYS:-60}"

newest="$(ls -1 "$BACKUP_SRC"/smartmess-*.sqlite 2>/dev/null | sort | tail -n 1 || true)"
[ -n "$newest" ] || { echo "[offsite] no backup found in $BACKUP_SRC" >&2; exit 1; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
name="$(basename "$newest").age"
# Encrypt BEFORE it leaves the machine: the file holds student records and password hashes.
age -r "$AGE_RECIPIENT" -o "$tmp/$name" "$newest"
rclone copyto "$tmp/$name" "$RCLONE_REMOTE/$name"
# Verify what arrived is what we sent (size + checksum), not just that the command exited 0.
rclone check "$tmp" "$RCLONE_REMOTE" --include "$name" --one-way
rclone delete "$RCLONE_REMOTE" --min-age "${KEEP_REMOTE_DAYS}d" --include 'smartmess-*.sqlite.age'
echo "[offsite] OK  $name → $RCLONE_REMOTE"
