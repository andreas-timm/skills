#!/usr/bin/env bash
set -euo pipefail

required_vars=(
    GITHUB_ENV
    GITHUB_RUN_ATTEMPT
    GITHUB_RUN_ID
    RELEASE_GIT_EMAIL
    RELEASE_GIT_NAME
    RELEASE_GPG_PRIVATE_KEY
    RUNNER_TEMP
)

for var in "${required_vars[@]}"; do
    if [ -z "${!var:-}" ]; then
        echo "::error::Set ${var} before configuring release signing."
        exit 1
    fi
done

mkdir -m 700 -p ~/.gnupg
chmod 700 ~/.gnupg
echo "allow-loopback-pinentry" >> ~/.gnupg/gpg-agent.conf
gpgconf --kill gpg-agent || true

# Accept either a raw ASCII-armored key or a base64-encoded one.
release_key="$RELEASE_GPG_PRIVATE_KEY"
if ! printf '%s' "$release_key" | grep -q 'BEGIN PGP PRIVATE KEY'; then
    release_key="$(printf '%s' "$RELEASE_GPG_PRIVATE_KEY" | base64 --decode 2>/dev/null || true)"
fi
if ! printf '%s' "$release_key" | grep -q 'BEGIN PGP PRIVATE KEY'; then
    echo "::error::RELEASE_GPG_PRIVATE_KEY is neither an ASCII-armored nor base64-encoded private key block."
    echo "::error::Re-run: gpg --armor --export-secret-subkeys '<SIGNING_SUBKEY_FPR>!' | gh secret set RELEASE_GPG_PRIVATE_KEY --body-file -"
    exit 1
fi
printf '%s\n' "$release_key" | gpg --batch --yes --import

cat > "$RUNNER_TEMP/gpg-loopback" <<'EOF'
#!/usr/bin/env bash
exec gpg --batch --yes --pinentry-mode loopback "$@"
EOF
chmod 700 "$RUNNER_TEMP/gpg-loopback"

cat > "$RUNNER_TEMP/semantic-release-tag-editor" <<'EOF'
#!/usr/bin/env bash
printf 'semantic-release signed release tag\n' > "$1"
EOF
chmod 700 "$RUNNER_TEMP/semantic-release-tag-editor"

# Derive the signing (sub)key fingerprint from the imported key material,
# preferring a signing-capable subkey and falling back to the primary.
signing_fpr="$(
    gpg --batch --with-colons --list-secret-keys --with-subkey-fingerprints |
        awk -F: '
            $1 == "ssb" && $12 ~ /s/ { want = 1; next }
            $1 == "fpr" && want { print $10; exit }
            $1 == "sec" || $1 == "ssb" { want = 0 }
        '
)"
if [ -z "$signing_fpr" ]; then
    signing_fpr="$(
        gpg --batch --with-colons --list-secret-keys --with-subkey-fingerprints |
            awk -F: '
                $1 == "sec" && $12 ~ /s/ { want = 1; next }
                $1 == "fpr" && want { print $10; exit }
            '
    )"
fi
if [ -z "$signing_fpr" ]; then
    echo "::error::RELEASE_GPG_PRIVATE_KEY has no signing-capable key."
    exit 1
fi

git config user.name "$RELEASE_GIT_NAME"
git config user.email "$RELEASE_GIT_EMAIL"
git config user.signingkey "${signing_fpr}!"
git config gpg.program "$RUNNER_TEMP/gpg-loopback"
git config commit.gpgsign true
git config tag.gpgSign true

test_tag="semantic-release-gpg-check-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
trap 'git tag -d "$test_tag" >/dev/null 2>&1 || true' EXIT
GIT_EDITOR="$RUNNER_TEMP/semantic-release-tag-editor" git tag "$test_tag" HEAD
git tag -v "$test_tag"

{
    echo "GIT_AUTHOR_NAME=$RELEASE_GIT_NAME"
    echo "GIT_AUTHOR_EMAIL=$RELEASE_GIT_EMAIL"
    echo "GIT_COMMITTER_NAME=$RELEASE_GIT_NAME"
    echo "GIT_COMMITTER_EMAIL=$RELEASE_GIT_EMAIL"
    echo "GIT_EDITOR=$RUNNER_TEMP/semantic-release-tag-editor"
} >> "$GITHUB_ENV"
