#!/usr/bin/env bash
set -euo pipefail

required_vars=(
    GITHUB_ENV
    GITHUB_RUN_ATTEMPT
    GITHUB_RUN_ID
    RELEASE_GIT_EMAIL
    RELEASE_GIT_NAME
    RELEASE_GPG_KEY_ID
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

if ! printf '%s\n' "$RELEASE_GPG_PRIVATE_KEY" | grep -q 'BEGIN PGP PRIVATE KEY'; then
    echo "::error::RELEASE_GPG_PRIVATE_KEY is not an ASCII-armored private key block."
    echo "::error::Re-run: gpg --armor --export-secret-subkeys '${RELEASE_GPG_KEY_ID}' | gh secret set RELEASE_GPG_PRIVATE_KEY --body-file -"
    exit 1
fi
printf '%s\n' "$RELEASE_GPG_PRIVATE_KEY" | gpg --batch --yes --import

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

git config user.name "$RELEASE_GIT_NAME"
git config user.email "$RELEASE_GIT_EMAIL"
git config user.signingkey "$RELEASE_GPG_KEY_ID"
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
