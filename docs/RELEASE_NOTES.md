Tank Chief installs as a proper application on Windows and Android. Both run
with no internet connection — that is the point, not a side effect.

## Downloads

| file | what it is |
|---|---|
| `TankChief-Setup-…-x64.exe` | Windows installer |
| `TankChief-Portable-…-x64.exe` | Windows, installs nothing — run it from a memory stick |
| `TankChief-….apk` | Android phone and tablet |

## Installing on Windows

Run the installer. It installs for the current user, so no administrator rights
are needed, and it offers to change the folder. You get a desktop and Start
menu shortcut called **Tank Chief**.

Windows will show a blue *"Windows protected your PC"* box, because the
installer is not signed with a commercial certificate. Click **More info**,
then **Run anyway**.

Vessel records for the **installer** go to `%APPDATA%\tank-chief\data\`.
The **portable** EXE keeps them beside the program under `TankChief-data\` so a
USB stick travels whole. **File → Open data folder** opens the active location.
Everything is plain JSON, one folder per vessel, so it can be copied or backed
up as it stands; uninstalling the installed build does not remove AppData.

The portable build installs nothing — copy it to a memory stick and run it.
Useful on a vessel where installing software is not permitted.

## Installing on Android

Install `TankChief-….apk` (stable sideload signature — same key as later
releases, so updates overwrite in place without uninstalling). Allow *"install
from unknown sources"* for your browser or file manager when it asks. Records
live in the app's own private storage. If an older **unsigned** build somehow
got onto the device, uninstall that one once; then future signed builds update
cleanly.

## What works with no connection

Everything, on both: vessel and tank setup, calibration tables, soundings, the
fuel oil report, voyage fuel calculation, bunker planning and live monitoring,
after bunkering, the bunkering summary and the voyage report. Nothing is sent
anywhere.

The one exception is importing calibration books from PDF or spreadsheets,
which needs Python and OCR. That works on Windows — the installer carries its
own Python and Tesseract, so it works on a computer with neither installed. It
cannot work on a phone. Import on Windows and sync to the phone.

## Using a shared copy

Both builds keep their own records. Under **Backup / Sync**, *Database* chooses
whether this device keeps its records on itself or on a server. To share, set
the server's address there, then **Pull** to bring records down or **Push** to
send them up. Nothing is transmitted until you press one of them.

---

*Tank Chief — ts0gs · Marvin C. Endozo*
