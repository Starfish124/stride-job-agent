#!/bin/sh
# Before you publish: search the repo for words that must never go public. The word list is yours and stays outside the repo (it IS the secret);
# one word or phrase per line, matched case-insensitively.
#
#   demo/leakscan.sh [denylist] [extra dir ...]
#
# Checks file contents, file names, any extra dirs (pass the demo data folder
# demo/shoot.ts prints: it is what the screenshots show), commit emails and
# commit messages.
# The copyright line in LICENSE is allowed to name its author.
# Exit 0 = clean.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
LIST=${1:-$HOME/.config/stride-job-agent/denylist.txt}
[ -f "$LIST" ] || { echo "no word list at $LIST"; exit 2; }
[ $# -gt 0 ] && shift
cd "$ROOT"
hits=0

report() {  # $1 = label, $2 = matching lines (not piped: a pipe is a subshell)
    if [ -n "$2" ]; then
        echo "LEAK  $1"
        echo "$2" | sed 's/^/      /'
        hits=$((hits + 1))
    fi
}

files=$(find . -type f ! -path './.git/*' ! -path './node_modules/*' ! -path './tui/target/*' ! -name '.DS_Store')
report "file contents" "$(echo "$files" | tr '\n' '\0' | xargs -0 grep -n -i -I -F -f "$LIST" -- \
    | grep -v '^\./LICENSE:[0-9]*:Copyright (c) ')"
report "file names" "$(echo "$files" | grep -i -F -f "$LIST")"
for d in "$@"; do
    report "extra dir $d" "$(grep -r -n -i -I -F -o -f "$LIST" -- "$d" | sort -u)"
done
if [ -d .git ] && git rev-parse HEAD >/dev/null 2>&1; then
    report "commit emails (want a noreply address)" \
        "$(git log --all --format='%ae%n%ce' | sort -u | grep -v '@users\.noreply\.github\.com$')"
    report "commit messages" "$(git log --all --format='%h %B' | grep -i -F -f "$LIST")"
fi

n=$(echo "$files" | wc -l | tr -d ' ')
echo "scanned $n files, $(wc -l < "$LIST" | tr -d ' ') words, $# extra dirs: $hits leak groups"
[ "$hits" -eq 0 ]
