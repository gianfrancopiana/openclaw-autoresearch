# Releasing

## Prerequisites

- npm access to `@gianfrancopiana`
- either npm account 2FA enabled for publishing, or a granular access token with `Bypass 2FA` enabled

## Release

1. Update the package version in `package.json`.
2. Sync the plugin manifest metadata:

   ```bash
   npm run sync:release-metadata
   ```

   If you change the minimum supported OpenClaw version, keep
   `openclaw.install`, `openclaw.compat`, and `openclaw.build` aligned too.

3. Run the release checks:

   ```bash
   npm install
   npm run release:verify
   ```

   CI runs the same release verification, so metadata drift should fail before
   publish.

4. Publish:

   ```bash
   npm publish --otp=123456
   ```

   Replace `123456` with the current code from your authenticator app.

5. Verify install:

   ```bash
   openclaw plugins install @gianfrancopiana/openclaw-autoresearch
   ```

   For a local OpenClaw checkout:

   ```bash
   pnpm openclaw plugins install @gianfrancopiana/openclaw-autoresearch
   ```

## Common failure

If `npm publish` fails with `E403` and mentions 2FA or bypass tokens, the current auth on this machine is not sufficient to publish. Either:

- re-run `npm publish --otp=<current-code>`
- or switch to a granular npm token with publish rights and `Bypass 2FA` enabled
