# BoatProvisioner

Openable macOS app for flashing and fully provisioning a Raspberry Pi SD card for the boat.

## Build

From the repo root:

```bash
./macos/BoatProvisioner/build-app.sh
```

That script:

- packages the current repo into a staged installer bundle
- cross-builds the Pi firmware
- builds the SwiftUI macOS front-end
- creates `macos/BoatProvisioner/build/BoatProvisioner.app`

## Open

```bash
open ./macos/BoatProvisioner/build/BoatProvisioner.app
```

The app prompts for an administrator password when you start the actual flash step.
