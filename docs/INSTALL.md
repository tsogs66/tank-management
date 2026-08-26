# Installing on Windows and Android

The program runs entirely on your own machine. It needs no internet connection
to work — going online is a deliberate act, described under *Working with a
server* below, and never a condition of the program running.

## Windows

### Getting the installer

Installers are built by GitHub Actions on a Windows machine and attached to a
release. They cannot be built on Linux: the installer embeds a Windows Python
interpreter and Tesseract, and the final executable has to be signed by Windows
tooling.

- **From a release** — push a tag beginning with `v` (`git tag v2.1.0 && git
  push origin v2.1.0`). The workflow builds `VesselFuelTMS-Setup-<version>-x64.exe`
  and attaches it to the release page, where anyone can download it.
- **Without cutting a release** — run *Desktop installer* from the repository's
  Actions tab. The installer is kept as a build artifact on that run.

### Installing

Run the `.exe`. It installs per-user by default, so no administrator rights are
needed, and it offers to change the folder. It creates a desktop and Start menu
shortcut called **Vessel Fuel TMS**.

There is also a portable build: one folder, copy it to a memory stick, run it
without installing. Useful on a vessel where installing software is not
permitted.

### Where the data lives

Vessel files are written to your own application data, not into the program
folder:

```
%APPDATA%\vessel-fuel-tank-management\data\
```

**File → Open data folder** opens it. Everything is plain JSON, one folder per
vessel, so it can be copied, backed up or handed to somebody else as it stands.
Uninstalling does not remove it.

### What is inside the installer

Electron provides the window, and the program's own local server runs inside
it, bound to `127.0.0.1` on a port Windows picks. It is not reachable from the
network and does not clash with anything already using a port.

Python 3.11 and Tesseract OCR are bundled, so the PDF calibration import, the
Excel import, the XLSX export and the lube spreadsheet all work on a computer
that has neither installed and no connection to fetch them. This is most of the
installer's size.

## Android phone and tablet

*Being built. Until the APK is available, the app installs from a browser: open
the hosted address in Chrome and choose **Install app** / **Add to home
screen**. It then runs offline from its cache, and writes are queued and sent
when the server is reachable again.*

## Working with a server

Both builds are standalone. If you also want a shared copy — a vessel PC that
several tablets read from, or an office server — set its address under
**Backup / Sync**:

- **Pull** brings that server's vessels down to this device.
- **Push** sends this device's vessels up to it.

Nothing is transmitted unless you press one of them. With no address set, the
program never opens a network connection at all.

## Building it yourself

```
npm ci                     # includes the desktop build tools
npm start                  # the server alone, on http://localhost:3080
npm run desktop            # the desktop window, against the repo's data folder
npm run stage:runtime      # fetch Python + packages (Windows only)
npm run dist:win           # build the installer (Windows only)
npm run dist:linux         # build an AppImage (works anywhere)
```

`npm run dist:win` on Linux fails at the signing step — that step needs Windows
tooling. Use the workflow.
