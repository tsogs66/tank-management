# Live sync over Wi-Fi or a phone hotspot

Two devices on the same Wi-Fi, or one on the other's hotspot, keep the same vessel level without a server in between.

**Pairing (once).** One device shows a six-digit code (Settings → Live sync → *Show pairing code*). The other finds it (*Find devices*, or type the address) and enters the code. Each then holds a token for the other. A code works once, for five minutes, and locks after five wrong tries. Nothing but `GET /api/lan/hello` answers an unpaired caller.

**Who calls whom.** A phone's copy of the server runs inside the app and cannot listen, so the phone always makes the connection (it scans the usual router, Android-hotspot and Windows-hotspot ranges, or you type the address). Two PCs announce themselves by UDP broadcast and either can call the other. One call moves data both ways.

**What syncs.** Every 20 seconds, while both devices are open, each asks the other which vessel is active and a fingerprint of it. Only if the two are on the **same ship** (IMO, else name) and the fingerprints differ do they exchange it, through the same merge Backup's peer sync uses: the vessel record by revision; gaugings, filed reports, drafts and bunkering history as a union, the newest copy of a record winning. A sync never deletes anything.

**Whole database.** *The whole database* in the same panel also keeps every vessel level, and a vessel one device does not have is created on it. Either way the panel names each vessel the other device lacks, with a *Copy* button, so nothing is copied without the user knowing.

**Not done.** Bluetooth (a hotspot is the same Wi-Fi). Syncing while the app is closed or the phone's screen is off. Deletions.

Tests: `scripts/test-lan-sync.js` (two real servers), `scripts/test-lan-phone.js` (the phone engine in Chromium against a real server).
