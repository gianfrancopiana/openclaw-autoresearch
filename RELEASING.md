# Releasing

## Prerequisites

- npm access to `@gianfrancopiana`
- either npm account 2FA enabled for publishing, or a granular access token with `Bypass 2FA` enabled

## Release

1. Update `package.json` and `openclaw.plugin.json` if you are changing the version.
   Keep `package.json#openclaw.install`, `package.json#openclaw.compat`, and
   `package.json#openclaw.build` aligned if the minimum supported OpenClaw
   version changes.
2. Run the release checks:

   ```bash
   npm install
   npm run release:verify
   ```

3. Publish:

   ```bash
   npm publish --otp=123456
   ```

   Replace `123456` with the current code from your authenticator app.

4. Verify install:

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
