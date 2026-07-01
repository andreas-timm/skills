# Local Dev Contributing

## Release signing

Semantic-release commits and tags as `Andreas Timm <info@andreas-timm.dev>` and signs the release commit and release tag with the signing subkey `7A25BDF642194B97663B77FF11671D835B202729`. The CI signing setup lives in [scripts/configure-release-signing.sh](scripts/configure-release-signing.sh).

The GitHub Actions workflow expects these repository secrets:

- `RELEASE_GPG_PRIVATE_KEY`: ASCII-armored private signing subkey (passphraseless).

Export only the signing subkey for CI:

```sh
gpg --armor --export-secret-subkeys '7A25BDF642194B97663B77FF11671D835B202729!' \
    | gh secret set RELEASE_GPG_PRIVATE_KEY --repo andreas-timm/skills --body-file -
```

The matching public key must also be present in the GitHub account's GPG keys for the signatures to show as verified.
