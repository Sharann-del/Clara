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
open ios/Clara.xcodeproj
```

Signing uses team `A1B2C3D4E5` and bundle id `com.sharannm.clara`; change both in the target's
Signing settings for another account. Free developer accounts can install at most 3 apps per device,
and the first launch needs Settings → General → VPN & Device Management → trust the developer.

Command-line build and install on a connected device:

```sh
xcodebuild -project ios/Clara.xcodeproj -scheme Clara -destination 'id=<UDID>' -allowProvisioningUpdates build
xcrun devicectl device install app --device <UDID> <DerivedData>/Build/Products/Debug-iphoneos/Clara.app
```

## Site content

The app includes the public site (docs, pricing, about, privacy, terms, playground examples).
After editing those pages on the web, regenerate the app's copy with the dev server running:

```sh
npm run frontend:dev &          # http://localhost:5173
node ios/scripts/export-site-content.mjs
```
