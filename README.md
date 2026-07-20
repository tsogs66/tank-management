# Vessel Fuel Tank Management System

Multi-vessel web app for fuel tank sounding (double interpolation + ASTM 54B), editable calibration tables, voyage fuel planning, bunkering distribution, and offline-capable sync between a local machine and a Proxmox LXC (Debian).

## Features

- **Multi-vessel database** — each vessel stored under `data/vessels/<id>/`
- **Tank sounding calculator** — trim/list double interpolation, volume curves, ASTM Table 54B VCF + WCF
- **Editable calibration DB** — correct trim/list grids and volume curves manually
- **Add tanks** — storage, settling, service (also overflow/other); CSV import template included
- **Voyage fuel calculation** — per-leg distance/speed/daily burn → arrival ROB
- **Bunkering** — enter received MT, then distribute:
  - equally across storage (free-space weighted)
  - port / starboard storage only
  - No.1 / No.2 tanks only
  - settling or service only
  - manual per-tank MT
- **Offline + sync** — IndexedDB cache + mutation queue; push/pull peer sync when online
- **Backup / import** — full JSON backup of vessels + settings
- **Android** — responsive PWA (Add to Home Screen)
- **Debian / Proxmox LXC** — systemd install script included

## Quick start (local)

```bash
npm install
npm run seed          # loads MV CAPTAIN VENIAMIS calibration tables
npm start             # http://0.0.0.0:3080
```

Open the URL in a browser (desktop or Android). Select the seeded vessel or create a new one under **Vessel Setup**.

## Data layout

```
data/
  settings.json
  vessels-index.json
  vessels/
    captain-veniamis/
      vessel.json
      tanks.json          # includes calibration grids
      readings.json
      voyage.json
      bunkering.json
      bunker-ops.json
      transfers.json
      meta.json           # revision for sync
```

## Excel workbook (calibration reference)

The repo includes `TANK MANAGEMENT CAPTAIN VENIAMIS FINAL VERSION.xlsm`. Sheets **Tank1–Tank4** are the calibration table reference:

| Block | Layout |
|-------|--------|
| Correction (Tank1 HFO/MDO style) | `SOUNDING ullage` rows × trim (m) columns → correction; `SOUNDING CM` / `sounding VOLUME`; list/heel table |
| Direct (Tank2–4 style) | `Depth` rows × trim columns → volume m³; second `Depth` × heel table |

In the app: **Calibration DB → open a tank** shows this Excel-style grid. Use **Import repo workbook** (or upload) to refresh tables from the `.xlsm`.

Also used from the workbook: **Setup** (pipe height / 100% & 85% capacity), **Conversion** (API → density @15°C), **ASTM Tables** (VCF 54B).

## CSV tank import

Download the template from the app (**Add Tank** page) or use `templates/tank-import.csv`.

Columns: `id,name,category,fuelRole,side,tankNo,fuelGrade,calcType,capacity,pipeHeight,soundingMethod,correctionDivisor`

After import, open **Calibration DB** to paste sounding tables.

## Proxmox LXC (Debian)

### Create LXC + install (run on Proxmox **host** as root)

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/tsogs66/tank-management/main/deploy/create-lxc.sh)"
```

Creates a Debian CT (auto CTID from 130), installs Fuel TMS, starts systemd on port **3080**.

Useful overrides:

```bash
CTID=140 HOSTNAME=fuel-tms PASSWORD='YourStrongPass' MEMORY=2048 DISK=16 \
  IP=static STATIC_IP=192.168.1.50/24 GATEWAY=192.168.1.1 \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/tsogs66/tank-management/main/deploy/create-lxc.sh)"
```

### Update existing LXC (host)

```bash
CTID=130 bash -c "$(curl -fsSL https://raw.githubusercontent.com/tsogs66/tank-management/main/deploy/update-lxc.sh)"
```

### Install / update inside an existing CT

```bash
# install
bash -c "$(curl -fsSL https://raw.githubusercontent.com/tsogs66/tank-management/main/deploy/proxmox.sh)"

# update (preserves data/vessels)
bash -c "$(curl -fsSL https://raw.githubusercontent.com/tsogs66/tank-management/main/deploy/update.sh)"
```

Optional: `PORT=3080 APP_DIR=/opt/tank-management BRANCH=main STORAGE=local-lvm BRIDGE=vmbr0`.

Point a second instance (ship laptop / office) at the LXC URL under **Backup / Sync → Peer sync URL**, then **Push** or **Pull**.

## Original workbook UI

`tank-management.html` remains as the standalone single-vessel calculator extracted from the CAPTAIN VENIAMIS workbook. The new app reuses the same formulas via `server/calc.js` / `public/js/calc.js`.

## API (selected)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/vessels` | List vessels |
| POST | `/api/vessels` | Create vessel |
| GET | `/api/vessels/:id` | Full vessel bundle |
| PUT | `/api/vessels/:id/tanks/:tankId/calibration` | Edit calibration |
| POST | `/api/vessels/:id/calculate` | Sounding calc + save |
| POST | `/api/vessels/:id/bunker-distribute` | Bunker distribution |
| GET | `/api/backup` | Full backup |
| POST | `/api/sync/pull` | Pull from peer |
| POST | `/api/sync/push` | Push to peer |

## Formulas (reference)

1. **Trim correction** — bilinear interp on sounding × trim grid ÷ divisor  
2. **List correction** — bilinear interp on corrected sounding × list grid ÷ divisor  
3. **Volume** — linear interp on volume curve (correction tanks) or bilinear volume grid (direct tanks)  
4. **VCF (ASTM 54B)** — density-banded α, `exp(−α·ΔT·(1+0.8·α·ΔT))`  
5. **Weight** — `volume@15°C × (density15 − 0.0011)`
