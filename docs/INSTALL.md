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

### Getting the APK

Built by GitHub Actions the same way as the Windows installer — push a `v*` tag
for a release, or run *Android APK* from the Actions tab for a build artifact.

The APK is **unsigned**. Signing needs a keystore, and a keystore belongs to
whoever publishes the app rather than in a repository. Install it with "install
from unknown sources" allowed for your browser or file manager, or sign it with
your own key before handing it out.

### It is standalone

The app carries its own database and runs the server's own routing on the
device. A phone in a tank room with no signal is a complete installation, not a
viewer for a cached copy: create vessels, enter soundings, compute a fuel
report, plan and monitor a bunkering, reconcile against the delivery note.

That claim is checked rather than asserted. `npm run parity` loads the same
vessel into a real server and into the device, asks both the same questions,
and diffs the answers field by field — every computed sheet, and saving,
history and deletion as well. The APK build runs it before packaging, so a
divergence stops the build rather than reaching a phone. A difference here
would not announce itself; it would be a tonnage slightly different from the
ship's computer, on a sheet somebody signs.

### What the phone cannot do

Importing a calibration book from a PDF or a spreadsheet. That work is Python
and OCR, which cannot run inside a webview. Those four features say so plainly
instead of failing in a way that could be mistaken for an empty table. Import
on Windows, then sync.

### Where the data lives

In the app's own storage, private to it. **Backup / Sync → Backup** writes a
file you can keep or move to another device; **Push** sends the records to a
server.

## Working with a server

Both builds are standalone. Under **Backup / Sync**, *Database* chooses where
this device keeps its records — on the device, or on the server that served the
page. It is a setting rather than an automatic fallback, deliberately: the two
hold separate records, and a request quietly answered by the other one would
put today's soundings somewhere nobody is looking. Switching asks first and
reloads.

If you also want a shared copy — a vessel PC that several tablets read from, or
an office server — set its address in the same place:

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

npm run embed              # copy the server files the phone runs into the bundle
npm run parity             # check the device answers what the server answers
npm run android:apk        # build the APK (needs the Android SDK)
```

`npm run dist:win` on Linux fails at the signing step — that step needs Windows
tooling. Use the workflow.
