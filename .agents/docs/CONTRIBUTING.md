# Local Dev Contributing

## Release signing

Semantic-release commits and tags as `Andreas Timm <info@andreas-timm.dev>` and signs the release commit and release tag with the signing subkey `D45B6E6A9019264E62C80FDA843965621C0988E9`. The CI signing setup lives in [.github/workflows/scripts/signing.sh](../../.github/workflows/scripts/signing.sh).

The GitHub Actions workflow expects these repository secrets:

- `RELEASE_GPG_PRIVATE_KEY`: ASCII-armored private signing subkey (passphraseless).

Export only the signing subkey for CI:

```sh
gpg --armor --export-secret-subkeys 'D45B6E6A9019264E62C80FDA843965621C0988E9!' \
    | gh secret set RELEASE_GPG_PRIVATE_KEY --repo andreas-timm/skills --body-file -
```

The matching public key must also be present in the GitHub account's GPG keys for the signatures to show as verified.
