# Signing & notarizing the macOS app

An unsigned `.dmg` makes macOS show *"Twin can't be opened because Apple
cannot check it for malicious software"* — every user has to right-click →
Open, or strip the quarantine flag. **Signing + notarizing removes that
entirely**: the app opens with a double-click like any other.

Twin's build is already wired for it (`src-tauri/tauri.conf.json` +
`src-tauri/entitlements.plist`). Signing turns on automatically when the
credentials below are present in the environment at build time — nothing is
committed to the repo, and the same `npm run dmg` produces a signed,
notarized installer once they're set.

## One-time Apple setup (only you can do this)

1. **Enrol in the Apple Developer Program** ($99/year) —
   <https://developer.apple.com/programs/>. A free Apple ID cannot notarize.
2. **Create a "Developer ID Application" certificate**: Xcode → Settings →
   Accounts → your team → *Manage Certificates* → **+** → *Developer ID
   Application*. It installs into your login keychain.
   - Confirm it's there: `security find-identity -v -p codesigning`
     lists a line like `"Developer ID Application: Your Name (TEAMID)"`.
3. **Note your Team ID** — the 10-character code in that identity string
   (also on <https://developer.apple.com/account> → Membership).
4. **Create an App Store Connect API key** for notarization (cleaner than an
   app-specific password): <https://appstoreconnect.apple.com/access/api> →
   *Keys* → **+**, role *Developer*. Download the `.p8` **once** and note the
   *Key ID* and *Issuer ID*.

## Build a signed, notarized dmg

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_API_ISSUER="<issuer-id-uuid>"
export APPLE_API_KEY="<key-id>"
export APPLE_API_KEY_PATH="/absolute/path/to/AuthKey_<key-id>.p8"
npm run dmg
```

Tauri signs the app with the hardened runtime and the bundled entitlements,
submits it to Apple's notary service, waits, and staples the ticket. The
first notarization can take a few minutes.

(Alternative to the API key: an app-specific password instead —
`APPLE_ID`, `APPLE_PASSWORD` (the app-specific password from
<https://account.apple.com> → Sign-In & Security), and `APPLE_TEAM_ID`.)

## Verify it worked

```bash
# The .app inside the mounted dmg:
codesign --verify --deep --strict --verbose=2 /Volumes/Twin/Twin.app
spctl -a -vvv -t install /Volumes/Twin/Twin.app   # → "accepted, source=Notarized Developer ID"
xcrun stapler validate /Volumes/Twin/Twin.app     # → "The validate action worked!"
```

A double-click install on a machine that has never seen the app is the real
test — it should open with no Gatekeeper warning.

## Until it's signed — coworker install

An **unsigned** dmg still works; macOS just guards the first launch:

- Right-click (or Control-click) the app → **Open** → **Open** again. Once
  per install.
- Or clear the quarantine flag: `xattr -dr com.apple.quarantine /Applications/Twin.app`.

## CI note

To sign in CI, import the certificate into a temporary keychain from a
base64 secret and export the same `APPLE_*` variables. Do this only in a
trusted runner — these credentials can sign software as you.
