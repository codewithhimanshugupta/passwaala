# NearBaz — Native App Build & Store Launch Guide

Three native apps are ready to build via **EAS (Expo Application Services) cloud build**:
**customer** (`apps/customer-app`), **shopkeeper** (`apps/shopkeeper-app`), **rider**
(`apps/rider-app`). Admin stays web-only. Everything below is what **you** run (it needs
your own Expo / Apple / Google accounts).

The apps point at the production API `https://api.nearbaz.in` (baked into every
EAS build profile — see each app's `eas.json`).

---

## 0. One-time setup

```bash
npm install -g eas-cli        # or use `npx eas-cli@latest` in place of `eas` below
eas login                     # your Expo account (create free at expo.dev if needed)
```

Then link each app to an EAS project **once** (this writes `extra.eas.projectId` into the
app's `app.json` — which is also what turns on push notifications):

```bash
cd apps/customer-app   && eas init && cd -
cd apps/shopkeeper-app && eas init && cd -
cd apps/rider-app      && eas init && cd -
```

Commit the three `app.json` changes afterwards (the added `projectId`).

---

## 1. Build the Android APKs (what you asked to run on your phone)

For **each** app, from its folder:

```bash
cd apps/customer-app
eas build -p android --profile preview
```

- The `preview` profile produces a standalone **APK** (`buildType: apk`, internal
  distribution) — installable directly, no Play Store needed.
- When it finishes (~10–20 min in the cloud) EAS prints a **download URL** and shows a QR
  code. Open the URL on your Android phone (or scan the QR) → download the `.apk` → tap to
  install (allow "install from unknown sources" once).
- Repeat for `shopkeeper-app` and `rider-app`.

> **Getting the APK to you:** the EAS build page hosts the `.apk` at a public download link
> for ~30 days. Send me that link (or run the command and share the URL it prints) and I can
> confirm it; you install it straight from the phone browser. I can't attach the binary here —
> it's produced on Expo's servers, not locally — but the download link is all you need.

Check the build list any time: `eas build:list` or at **expo.dev → your project → Builds**.

### Android maps note
You have no Google Maps API key yet, so **maps render blank on Android** (no crash; the rest
of the app works). iOS uses Apple Maps and needs no key. When you get a free key
(Google Cloud Console → enable **Maps SDK for Android** → create an API key), add this block
to each app's `app.json` under `expo.android` and rebuild:

```json
"config": { "googleMaps": { "apiKey": "YOUR_ANDROID_MAPS_KEY" } }
```

(Only the customer & shopkeeper apps render maps; the rider app has no in-app map.)

---

## 2. Check the iOS app on iPhone

Our apps use custom native modules (maps, notifications, secure store), so **Expo Go will not
work** — you need a real build. Two paths:

### A. Free — iOS Simulator on your Mac (fastest smoke test)
Requires Xcode installed (App Store).
```bash
cd apps/customer-app
eas build -p ios --profile preview   # then choose "simulator" if prompted
# OR build locally without EAS:
npx expo run:ios
```
Drag the resulting `.app` onto a booted Simulator (or `expo run:ios` launches it directly).
This validates the whole UI/flow on iOS; GPS/camera are simulated.

### B. Real iPhone — needs the Apple Developer Program ($99/yr)
1. Enrol at developer.apple.com. 
2. `eas build -p ios --profile preview` — EAS runs `eas credentials` to create the signing
   cert & provisioning profile (log in with your Apple ID when prompted).
3. To install on a specific device, register its UDID (`eas device:create`), or push to
   **TestFlight**: `eas submit -p ios` after a `--profile production` build. TestFlight is the
   normal way to test on your own iPhone before release.

There is no way to install on a physical iPhone without an Apple Developer account — that's an
Apple restriction, not ours. Use the Simulator (path A) until you enrol.

---

## 3. Reviewer login (for App Store / Play review)

Reviewers can't receive SMS, so seed fixed accounts in production once:
```bash
cd api && npx ts-node prisma/seed-reviewer.ts   # non-destructive, idempotent
```
Give reviewers these in the store "App Access" / "Sign-in required" notes (phone WITHOUT +91;
the app adds it). Log in with the **PIN** method:

| App | Phone | PIN |
|---|---|---|
| Customer | `9000012345` | `2468` |
| Shopkeeper | `9000023456` | `2468` |
| Rider | `9000034567` | `2468` |

(Password login also works: password `Review@2026`.)

---

## 4. Store data-safety / privacy forms

Fill these in the consoles to match what the apps actually do:

**Collected & linked to the user:** phone number, name, precise location (in-use only),
delivery addresses, photos (product/storefront/KYC), UPI payment reference, order/delivery
history, push token.
**NOT collected:** card/bank details, contacts, browsing history, biometrics.
**Tracking:** **None** — we do not track across other apps/companies (Apple ATT = "not used to
track"; that's why `NSUserTrackingUsageDescription` says so).

- **Apple → App Privacy:** declare the above under Contact Info, Location (Precise),
  User Content (Photos), Financial Info (payment ref only), Identifiers. Data Use =
  "App Functionality"; Tracking = No.
- **Google Play → Data Safety:** same categories; "Data is encrypted in transit" = Yes;
  "Users can request deletion" = Yes (in-app + your deletion URL).
- **Account deletion:** in-app **Profile/Settings → Delete account** exists in all 3 apps.
  Play also needs a public deletion URL — see the privacy policy doc.

## 5. Payments — no in-app-purchase billing
The apps sell **physical goods & delivery** paid by **UPI or cash on delivery**, handled
outside the app. This is explicitly allowed **without** Apple IAP / Google Play Billing
(those are only for digital goods). Note this in App Review notes to avoid a 3.1.1 rejection.

## 6. Privacy policy
Host `docs/PRIVACY_POLICY.md` at a public URL (e.g. `https://nearbaz.in/privacy`), fill the
`[FILL IN]` fields, and link it in each store listing + inside each app's settings.

---

## 7. Production builds (when you're ready to ship)
Same commands with `--profile production` (AAB for Play, store build for iOS), then
`eas submit -p android` / `eas submit -p ios`. You'll also need: store screenshots, app
descriptions, a 512px icon (Play) / listing icon, and content rating questionnaires.
