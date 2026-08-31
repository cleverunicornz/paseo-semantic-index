#!/usr/bin/env bash
set -euo pipefail

version=${1#v}
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Expected a semantic version, received: $1" >&2
  exit 1
fi

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
expected=$(node -p 'require(process.argv[1]).version' "$root/package.json")
if [[ "$version" != "$expected" ]]; then
  echo "Package version $expected does not match requested release $version" >&2
  exit 1
fi

for package in engine service paseo-plugin indexctl; do
  package_version=$(node -p 'require(process.argv[1]).version' "$root/packages/$package/package.json")
  if [[ "$package_version" != "$version" ]]; then
    echo "packages/$package version $package_version does not match $version" >&2
    exit 1
  fi
done

if [[ ! -d "$root/node_modules/.pnpm" ]]; then
  echo "Run the locked pnpm install before packaging" >&2
  exit 1
fi
if [[ ! -f "$root/packages/indexctl/dist/cli.js" ]]; then
  echo "Build indexctl before packaging" >&2
  exit 1
fi

release="$root/dist/release"
stage="$release/stage"
package_root="$stage/paseo-semantic-index"
artifact="$release/paseo-semantic-index-v${version}-linux-x64.tar.gz"
rm -rf "$release"
mkdir -p "$package_root/assets/tree-sitter"

cp "$root"/{.npmrc,LICENSE,README.md,THIRD_PARTY_NOTICES.md,UPSTREAM.md,package.json,pnpm-lock.yaml,pnpm-workspace.yaml,tsconfig.base.json} "$package_root/"
cp -a "$root/packages" "$package_root/"
cp -a "$root/node_modules" "$package_root/"
cp "$root/packages/engine/node_modules/web-tree-sitter/tree-sitter.wasm" \
  "$package_root/assets/tree-sitter/tree-sitter.wasm"
cp "$root"/packages/engine/node_modules/tree-sitter-wasms/out/*.wasm \
  "$package_root/assets/tree-sitter/"
chmod 0755 "$package_root/packages/indexctl/dist/cli.js"

commit=$(git -C "$root" rev-parse HEAD)
source_date_epoch=${SOURCE_DATE_EPOCH:-$(git -C "$root" show -s --format=%ct HEAD)}
cat > "$package_root/BUILD-METADATA.json" <<EOF
{
  "version": "$version",
  "commit": "$commit",
  "platform": "linux-x64",
  "node": "$(node --version)",
  "pnpm": "$(corepack pnpm --version)"
}
EOF

node "$package_root/packages/indexctl/dist/cli.js" --help >/dev/null

tar \
  --sort=name \
  --mtime="@${source_date_epoch}" \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  -C "$stage" \
  -cf - \
  paseo-semantic-index | gzip -n > "$artifact"
sha256sum "$artifact" > "$artifact.sha256"

tar -tzf "$artifact" | grep -Fx 'paseo-semantic-index/packages/paseo-plugin/paseo-plugin.json' >/dev/null
tar -tzf "$artifact" | grep -Fx 'paseo-semantic-index/packages/indexctl/dist/cli.js' >/dev/null
tar -tzf "$artifact" | grep -Fx 'paseo-semantic-index/assets/tree-sitter/tree-sitter.wasm' >/dev/null

rm -rf "$stage"
printf '%s\n' "$artifact" "$artifact.sha256"
