/* Tank Chief operating guide. Shown on the About page. */
(function () {
  const ITEMS = [
    {
      group: 'Start',
      q: 'Where do I start the first time?',
      purpose: 'Tank Chief turns a sounding into volume and weight, using trim, list, and the ship’s calibration tables. Each ship has its own tanks. The app keeps working with no internet.',
      steps: [
        'Open the app and choose the ship. In the standalone app the ship list is under More. Press Setup to name the ship, then Save vessel details.',
        'Open More → Add Tank for any tank that is not on the ship yet, then Calibration, and save the sounding table.',
        'Open the tank, enter the sounding, trim, and list, and save.',
        'Inside ChEng AIO the ship is the one in the AIO top bar. Setup on this menu is hidden there, because AIO Vessel Setup holds the name, IMO, signature, and stamp. Bunker Plan and Bunker Consumption open from the AIO menu as Bnk Plan and Cons Plan.'
      ],
      buttons: [
        'Setup — the ship, in the standalone app',
        'Save vessel details / Create vessel — stores that ship',
        'About — this guide, and Check for latest release'
      ],
      undo: [
        'Choosing the wrong ship does not delete tanks. Switch back to the right ship before you type a sounding.',
        'A wrong name is corrected on Setup and saved again.'
      ]
    },
    {
      group: 'Start',
      q: 'What is each page for?',
      purpose: 'The bottom menu is the daily work. More holds the tank groups, calibration, and backup.',
      steps: [
        'Summary — the tank overview.',
        'Monitoring — the fuel-oil condition report from the current tanks.',
        'Bunkering — the survey after delivery.',
        'Bunker Summary — bunker delivery note figures against what you measured.',
        'Voyage Report — the voyage tank report.',
        'Sounding — the sounding card you can take to the deck.',
        'More → Fuel Oil, Lube Oil, Misc / Bilge, Fresh Water — the tanks in that group.',
        'More → Add Tank — a tank that is not listed yet.',
        'More → Calibration — the sounding table for a tank.',
        'More → Bunker Plan — the fill sequence and the pumping clock. In ChEng AIO this opens from Bnk Plan instead.',
        'More → Cons. — bunker consumption by distance and daily burn. In ChEng AIO this opens from Cons Plan.',
        'More → VCF/WCF — volume and weight factors on their own.',
        'More → ISO 8217 — the marine fuel grade limits.',
        'More → Backup — export, import, and peer sync.',
        'More → Notes — a note or reminder for this ship, with a deadline. Tick Show at open and it appears when the program opens. Inside ChEng AIO this page is the suite Notes menu.',
        'More → About — this guide.'
      ],
      buttons: [
        'More — the rest of the pages',
        'Bright — daylight colours. The tank figures do not change'
      ],
      undo: [
        'Changing page does not delete a tank. A sounding is kept only after you save that tank.'
      ]
    },
    {
      group: 'Start',
      q: 'How do I keep a note or a reminder?',
      purpose: 'Notes holds something you must not forget for this ship. A ticked line appears when Tank Chief opens, with its deadline. Inside ChEng AIO the same job is the Notes page on the suite menu.',
      steps: [
        'Open More → Notes. On a wide screen it is under System.',
        'Type the title and the note. Set the deadline date and time.',
        'Leave Show when the program opens ticked if it should appear at startup.',
        'Press Save note.',
        'The next open lists the ticked lines. Close leaves them set. Stop reminding unticks that line.'
      ],
      buttons: [
        'Show when the program opens — the checkbox on the form and at the start of each line',
        'Save note — stores the line on this device for the active ship',
        'Edit — puts that line back in the form',
        'Delete — removes the line after you confirm',
        'Stop reminding — unticks that line without deleting it'
      ],
      undo: [
        'Untick Show at open to stop the startup list and keep the note.',
        'A wrong deadline: press Edit, set the date and time, and Save changes.',
        'Delete asks you to confirm. After that the line is gone from this device.'
      ]
    },
    {
      group: 'Soundings',
      q: 'How do I add a tank and its calibration table?',
      purpose: 'Without a calibration table the program cannot turn a sounding into cubic metres. The table is that tank’s sounding book.',
      steps: [
        'More → Add Tank. Name it, choose the group, the side, and the role (storage, settling, service, or overflow).',
        'Save the tank, then open Calibration.',
        'Type the sounding and volume rows, or import the ship’s CSV, Excel, or PDF table when that control is on the page.',
        'Press Save calibration.',
        'Take a known sounding and compare the volume with the paper book before you trust the table.'
      ],
      buttons: [
        'Add Tank — an empty tank on this ship',
        'Save calibration — stores the table you are editing',
        'Export CSV / Export Excel / Export JSON — a copy of the table',
        'Delete tank — on the tank itself. Removes that tank from this ship'
      ],
      undo: [
        'A wrong row: edit it and press Save calibration again.',
        'A tank added by mistake: open it and press Delete tank. Export the vessel from Backup first if that tank already has history.',
        'There is no undo on Delete tank. Add the tank again and restore the table from the file you exported.'
      ]
    },
    {
      group: 'Soundings',
      q: 'How do I take a sounding with trim and list?',
      purpose: 'The tape reading is not yet the volume. Tank Chief applies heel (list) and trim, then the calibration table, then density and temperature when you need weight in air.',
      steps: [
        'Open the tank from Summary or from its group under More.',
        'Enter the sounding or ullage, the trim, and the list, in the sense the form asks.',
        'Enter temperature and density at 15 °C when the result should be metric tons.',
        'Read the corrected sounding, the observed volume, and, when density is present, the weight in air.',
        'Save the tank. Summary uses that reading.'
      ],
      buttons: [
        'The save control on the open tank — writes this reading',
        'VCF/WCF — a check of the factors when a weight looks odd'
      ],
      undo: [
        'Before you save: change the number.',
        'After you save: open the same tank, type the right sounding, trim, and list, and save again. The latest save is the current reading.',
        'Do not rebuild a voyage log to fix a tank. The log, when you use Voyage Chief, is a separate record until you apply a survey there.'
      ]
    },
    {
      group: 'Reports',
      q: 'How do I make the monitoring sheet, the bunkering survey, and the sounding card?',
      purpose: 'These reports copy the tanks as they stand. Correct the tanks first. A saved snapshot is not rewritten when you later change a live tank.',
      steps: [
        'Correct the tank readings.',
        'Open Monitoring, Bunkering, Bunker Summary, Voyage Report, or Sounding.',
        'Check the totals against the tape book.',
        'Save the sheet. On the fuel report, Save keeps it and Print & Save keeps a snapshot and prints.',
        'On the voyage tank report, Save only stores without printing.'
      ],
      buttons: [
        'Save — stores the sheet you are looking at',
        'Print & Save — a snapshot plus paper',
        'Save only — the voyage tank report, without printing'
      ],
      undo: [
        'If the live tanks were wrong, correct them and save the report again.',
        'An older snapshot stays among the saved reports. It is not deleted by a later save.',
        'A reading you take after a saved report stays. Opening that older report does not roll the newer reading backwards.'
      ]
    },
    {
      group: 'Reports',
      q: 'How do I plan a bunker and check consumption?',
      purpose: 'Bunker Plan is the delivery: fill sequence, target ullages, rate, and the pumping clock. After Bunkering is the re-sound. Bunker Summary compares the delivery note with what you measured. Bunker Consumption plans the passage by distance, speed, and daily burn. In ChEng AIO those two planning screens open from Bnk Plan and Cons Plan.',
      steps: [
        'Before the barge: open Bunker Plan, set the tanks and the quantities, and save the plan.',
        'During and after the hose: use the pumping clock on the plan, then Bunkering to re-sound.',
        'Open Bunker Summary and compare the BDN with the measured intake.',
        'For the passage: open Cons. (Bunker Consumption), enter distance, speed, and daily burn, and read the arrival ROB.',
        'If you also keep Voyage Chief, log the delivery there as a receipt. The tank survey and the voyage receipt are two records.'
      ],
      buttons: [
        'Save plan — stores the bunker plan',
        'Save — on the consumption sheet and the reports',
        'The bunkering screens — plan, after survey, and summary are three steps of one operation'
      ],
      undo: [
        'A plan saved too early: change the figures and save again.',
        'A survey saved before the tanks were final: correct the tanks and save the bunkering page again.',
        'Clearing a plan on screen does not restore an older file. Export the vessel first if you may need today’s figures back.'
      ]
    },
    {
      group: 'Fix a mistake',
      q: 'The quantity on a tank is wrong.',
      purpose: 'A wrong tonne figure is a sounding, a trim or list, a density, or a calibration row. The summary only displays what the tank saved.',
      steps: [
        'Open that tank and check the sounding, trim, list, temperature, and density. Save the corrected reading.',
        'If every sounding on that tank is wrong by a similar amount, open Calibration and compare the table with the ship’s book. Fix the row and press Save calibration.',
        'Then open Monitoring or the report you already issued and save it again if the paper should match the tanks.'
      ],
      buttons: [
        'Save calibration — replaces the table with what is on screen',
        'Export CSV — a copy of the table before you edit it'
      ],
      undo: [
        'Export the table before a large calibration edit. Import that file if the edit was wrong.',
        'The tank’s current reading is whatever you saved last. Save the right reading over it.'
      ]
    },
    {
      group: 'Fix a mistake',
      q: 'I deleted a tank, or I imported the wrong vessel.',
      purpose: 'Delete tank removes that tank from this ship. Import can merge with the ships already here, or replace, depending on the Merge box.',
      steps: [
        'If the delete has not been confirmed, cancel it.',
        'If the tank is gone, Add Tank again and restore the calibration from an export.',
        'On Backup, Import with Merge with existing vessels ticked keeps ships already on this device and combines the file.',
        'Untick merge only when this device should take the file as the replacement. Export this device first.'
      ],
      buttons: [
        'Delete tank — removes that tank. There is no undo button',
        'Export active vessel — one ship as a file',
        'Import — brings a backup in. Merge with existing vessels is ticked by default',
        'Download backup — the full database, from the backup page'
      ],
      undo: [
        'Keep an export from before the import. If the import was wrong, import that file again.',
        'A deleted tank comes back only if you add it and load a calibration you saved.'
      ]
    },
    {
      group: 'Backup',
      q: 'How do I copy the tanks to another PC, or hand them to the relief?',
      purpose: 'The working copy follows the ship that is open. Push sends that ship to the server. Pull brings back the files uploaded for the same ship. Flush offline queue sends edits that were made with no link.',
      steps: [
        'Open More → Backup.',
        'Download the full backup, or Export active vessel for one ship. Keep the file.',
        'On the other device, Import. Leave Merge with existing vessels ticked if that device already has ships you want to keep.',
        'For a live server: set the peer URL (standalone Tank Chief is usually port 3080, ChEng AIO is usually port 8080), Save settings, Test connection.',
        'Pull from peer brings the files uploaded for the ship that is open. Push to peer sends this device. Read the note on the page before you press either. Flush offline queue sends changes that waited offline.',
        'On the relief’s device, open Summary and confirm the latest readings and the latest saved report.'
      ],
      buttons: [
        'Download backup — the full file',
        'Export active vessel — one ship',
        'Import — merge or replace from a file',
        'Save settings — remembers the peer address and token',
        'Test connection — checks the peer before a push',
        'Pull from peer — the files uploaded for this ship come back onto it',
        'Push to peer — this device goes to the server',
        'Flush offline queue — sends edits saved while offline'
      ],
      undo: [
        'Export this device before a pull or an import. If the result is wrong, import that file.',
        'A failed test connection changes nothing. Correct the URL or the token and test again.',
        'Keep your file until the relief agrees the latest tanks.'
      ]
    },
    {
      group: 'Backup',
      q: 'How do I update the app without losing the tanks?',
      purpose: 'Install the new package over the existing one. The tanks stay on the device when you do not remove the app first.',
      steps: [
        'Open About and press Check for latest release when you have a connection.',
        'Install the new package over this one.',
        'Open the app, select the same ship, and confirm Summary still shows the tanks.'
      ],
      buttons: [
        'Check for latest release — asks whether a newer Tank Chief is published',
        'Install on phone or tablet — adds the page to the home screen when the browser offers it'
      ],
      undo: [
        'If the app was removed and the tanks are gone, Import the backup you exported before the removal.',
        'If the ship list looks empty, select the ship again. The tanks follow that ship.'
      ]
    }
  ];

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function list(title, rows) {
    if (!rows || !rows.length) return '';
    return '<h3 class="op-guide-sub">' + esc(title) + '</h3><ol class="op-guide-steps">' +
      rows.map((row) => '<li>' + esc(row) + '</li>').join('') + '</ol>';
  }

  function ensureStyle() {
    if (document.getElementById('op-guide-style')) return;
    const style = document.createElement('style');
    style.id = 'op-guide-style';
    style.textContent = [
      '.op-guide-search{width:100%;box-sizing:border-box;margin:8px 0 10px;padding:10px 12px;border-radius:8px;border:1px solid var(--line, rgba(255,255,255,.2));background:transparent;color:inherit;font:inherit;}',
      '.op-guide-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;}',
      '.op-guide-chip{border:1px solid var(--line, rgba(255,255,255,.2));background:transparent;color:inherit;border-radius:999px;padding:6px 10px;font:inherit;font-size:12px;cursor:pointer;}',
      '.op-guide-chip.is-on{background:var(--accent, #c4a46a);color:#1a140c;border-color:transparent;font-weight:700;}',
      '.op-guide-item{border-top:1px solid var(--line, rgba(255,255,255,.12));padding:8px 0;}',
      '.op-guide-item summary{cursor:pointer;font-weight:700;line-height:1.4;color:var(--text, inherit);}',
      '.op-guide-purpose{margin:8px 0 0;line-height:1.55;}',
      '.op-guide-sub{margin:14px 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;}',
      '.op-guide-steps{margin:0 0 8px;padding-left:1.25rem;line-height:1.55;}',
      '.op-guide-steps li{margin-bottom:4px;}'
    ].join('');
    document.head.appendChild(style);
  }

  function render(host) {
    if (!host) return;
    ensureStyle();
    const groups = ['All'].concat(ITEMS.map((item) => item.group).filter((name, i, all) => all.indexOf(name) === i));
    host.innerHTML =
      '<h2>How to operate</h2>' +
      '<p>Search a question. Each answer says what the job is for, the steps, what the buttons do, and how to undo a mistake.</p>' +
      '<label for="tankGuideSearch">Search the guide</label>' +
      '<input id="tankGuideSearch" class="op-guide-search" type="search" placeholder="Try: sounding, calibration, delete tank, backup" autocomplete="off">' +
      '<div class="op-guide-chips" id="tankGuideChips"></div>' +
      '<p class="hint" id="tankGuideCount"></p>' +
      '<div id="tankGuideList"></div>';
    const search = host.querySelector('#tankGuideSearch');
    const chips = host.querySelector('#tankGuideChips');
    const listEl = host.querySelector('#tankGuideList');
    const countEl = host.querySelector('#tankGuideCount');
    let active = 'All';
    groups.forEach((name) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'op-guide-chip' + (name === active ? ' is-on' : '');
      btn.textContent = name;
      btn.addEventListener('click', () => {
        active = name;
        chips.querySelectorAll('.op-guide-chip').forEach((el) => {
          el.classList.toggle('is-on', el.textContent === active);
        });
        draw();
      });
      chips.appendChild(btn);
    });
    function hay(item) {
      return [item.group, item.q, item.purpose].concat(item.steps, item.buttons, item.undo).join(' ').toLowerCase();
    }
    function draw() {
      const q = search.value.trim().toLowerCase();
      const shown = ITEMS.filter((item) => (active === 'All' || item.group === active) && (!q || hay(item).indexOf(q) !== -1));
      if (!shown.length) {
        listEl.innerHTML = '<p>Nothing matches. Try sounding, bunker, delete, or backup.</p>';
      } else {
        let html = '';
        let last = '';
        shown.forEach((item) => {
          if (item.group !== last) {
            html += '<h3 class="op-guide-sub">' + esc(item.group) + '</h3>';
            last = item.group;
          }
          html += '<details class="op-guide-item"' + (q ? ' open' : '') + '><summary>' + esc(item.q) + '</summary>' +
            '<p class="op-guide-purpose">' + esc(item.purpose) + '</p>' +
            list('Steps', item.steps) + list('Buttons', item.buttons) + list('If this was a mistake', item.undo) +
            '</details>';
        });
        listEl.innerHTML = html;
      }
      countEl.textContent = shown.length + (shown.length === 1 ? ' topic' : ' topics') + (q ? ' match the search.' : ' in this list.');
    }
    search.addEventListener('input', draw);
    draw();
  }

  window.TankGuide = { render: render, items: ITEMS };
})();
