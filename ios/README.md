# Clara for iOS

Native SwiftUI app for iPhone and iPad, with the same design system as the web app (dark only,
solid neutral surfaces, no borders, Bricolage Grotesque / Instrument Sans / JetBrains Mono) and
full feature parity: workspaces and folders, search, markdown documents with live diagram embeds,
the diagram canvas editor, Code tab (Clara DSL and Mermaid), states and present mode, C4
drill-down, export (SVG/PNG/PDF/Mermaid), sharing and public links, members, version history,
AI pending-change review, access tokens, and live collaboration (presence, live typing, canvas edits).

## How it fits together

- **Same backend**: `@clara/api` over REST, the realtime WebSocket for canvas edits/presence, and
  Cognito (`USER_PASSWORD_AUTH`) for sign-in. Tokens live in the Keychain.
- **Same logic**: `scripts/shared-bridge.ts` bundles `@clara/shared` (DSL + Mermaid parsing, Dagre
  layout, diffing, SVG export, embeds) plus `marked` and `diff` into `Clara/Resources/clara-shared.js`,
  which runs in JavaScriptCore (`Core/SharedJS.swift`). Markdown is tokenized by `marked` and drawn natively.
- **Native drawing**: `Diagram/` ports render.ts geometry, label wrapping (text.ts), the dark/light
  palettes and states.ts, and draws with SwiftUI `Canvas`.

## Setup

```sh
ios/scripts/configure.sh        # Clara/Resources/ClaraConfig.json from packages/frontend/.env
ios/scripts/build-shared-js.sh  # after changing packages/shared
ios/scripts/fetch-fonts.sh      # OFL fonts into Clara/Fonts (falls back to SF without them)
cp ios/Config/Local.example.xcconfig ios/Config/Local.xcconfig   # then set your team and bundle ID
open ios/Clara.xcodeproj
```

**Endpoints.** `Clara/Resources/ClaraConfig.json` is generated and gitignored, so the app always
talks to the same stack as your web build. `Config/ClaraConfig.example.json` shows the format. The
app stops at launch with a message pointing at `configure.sh` if the file is missing.

**Signing.** `Config/Signing.xcconfig` (committed) sets neutral defaults (no team, bundle ID
`dev.clara.ios`) so the project builds anywhere, and includes `Config/Local.xcconfig` (gitignored)
when it exists. Put your Apple team ID and a bundle ID you own there. The keychain service name is
derived from the bundle ID. Free developer accounts can install at most 3 apps per device, and the
first launch needs Settings → General → VPN & Device Management → trust the developer.

Command-line build and install on a connected device:

```sh
xcrun devicectl list devices            # find your device's identifier
UDID=00008030-001A2B3C4D5E802E          # example; use the identifier from the list
xcodebuild -project ios/Clara.xcodeproj -scheme Clara -destination "id=$UDID" \
  -derivedDataPath build/ios -allowProvisioningUpdates build
xcrun devicectl device install app --device "$UDID" build/ios/Build/Products/Debug-iphoneos/Clara.app
```

## Site content

The app includes the public site (docs, pricing, about, privacy, terms, playground examples).
After editing those pages on the web, regenerate the app's copy with the dev server running:

```sh
npm run frontend:dev &          # http://localhost:5173
node ios/scripts/export-site-content.mjs
```
