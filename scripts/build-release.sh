#!/usr/bin/env bash
# Build the plugin as WordPress.org gets it, into dist/vocalstack (and
# dist/vocalstack.zip with --zip): production dependencies only, the SDK
# prefixed into vendor-prefixed/ by Strauss, the scripts compiled, and the
# readable source kept beside them, minus everything in .distignore.
#
# Used by .github/workflows/release.yml; run it locally to check a release.
set -euo pipefail

STRAUSS_VERSION=0.30.0
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist"
STAGE="$OUT/vocalstack"

rm -rf "$OUT"
mkdir -p "$STAGE"

# The committed files (nothing untracked or ignored slips in).
git -C "$ROOT" archive --format=tar HEAD | tar -x -C "$STAGE"

# Compiled scripts and styles.
( cd "$ROOT" && npm run build --silent )
cp -R "$ROOT/build" "$STAGE/build"

# Production dependencies, then the SDK moved under VocalStack\WP\Vendor\.
cd "$STAGE"
composer install --no-dev --no-interaction --no-progress --quiet
curl -fsSL -o "$OUT/strauss.phar" "https://github.com/BrianHenryIE/strauss/releases/download/${STRAUSS_VERSION}/strauss.phar"
php "$OUT/strauss.phar" --quiet 2>/dev/null || php "$OUT/strauss.phar"
composer dump-autoload --no-dev --optimize --no-interaction --quiet

# Point the plugin's own code at the prefixed SDK. Ours is all under
# VocalStack\WP\, the SDK's is every other VocalStack\ name, so the rewrite
# leaves our namespace alone (Strauss's own call-site rewrite doesn't: the
# SDK's root namespace is a prefix of ours).
find "$STAGE/src" "$STAGE/blocks" "$STAGE/templates" "$STAGE/vocalstack.php" "$STAGE/uninstall.php" -name '*.php' -print0 |
	xargs -0 perl -pi -e 's/(?<![\w\\])(\\?)VocalStack\\(?!WP\b)/$1VocalStack\\WP\\Vendor\\VocalStack\\/g'
if grep -rnE '(^|[^A-Za-z0-9_\\])\\?VocalStack\\(Http|Resources|Connect|Upload|VocalStack|Realtime)' "$STAGE/src" "$STAGE/blocks" "$STAGE/templates" "$STAGE/vocalstack.php" | grep -v 'VocalStack\\WP\\Vendor\\VocalStack' ; then
	echo "An SDK reference was left unprefixed." >&2
	exit 1
fi

# Drop what doesn't ship.
while IFS= read -r line; do
	case "$line" in ''|\#*) continue ;; esac
	rm -rf "$STAGE/${line#/}"
done < "$ROOT/.distignore"
rm -f "$OUT/strauss.phar"

if [ "${1:-}" = "--zip" ]; then
	( cd "$OUT" && zip -qr vocalstack.zip vocalstack )
	echo "Built $OUT/vocalstack.zip"
else
	echo "Built $STAGE"
fi
