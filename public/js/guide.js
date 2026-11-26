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
    },
    {
      group: "Bunkering",
      q: "How do I bunker residual and distillate fuel at the same time?",
      purpose: "One barge can deliver through two hoses. The Bunker Plan has a residual line (HFO or VLSFO) and an optional distillate line (MDO/MGO or LSMGO), each with its own rate, tanks and pumping clock.",
      steps: [
        "Open Bunker Plan and press Add distillate line. The page now has a Residual line and a Distillate line tab, and a strip showing both lines and the whole delivery.",
        "On each line set the grade, density, temperature, quantity and delivery rate. Date, port, drafts and heel are the residual line's and are not repeated.",
        "Each line offers only its own kind of tank. A tank can be in one line only; the page warns you if it is in both.",
        "Press Start pumping on each line when its hose is on. They run on separate clocks and can start at different times.",
        "Tap a line card in the strip to move to that line. The valve warning watches the tanks of both lines.",
        "Print and Save gives one combined sheet with both lines. On Bunker Summary press Add distillate BDN to reconcile the second delivery note against the distillate you measured.",
        "If most of the fuel goes to one side, the page warns you to watch the list and trim as you load."
      ]
    },
    {
      group: "Bunkering",
      q: "How do I run a bunkering plan with the pumping clock?",
      purpose: "Bunker Plan is the delivery: the fill sequence, the target ullage for each tank, the delivery rate, and a pumping clock with a valve warning.",
      steps: [
        "Open Bunker Plan (Bnk Plan inside ChEng AIO). Enter the date, voyage, port, drafts, heel, fuel type, grade, density @15, temperature, delivery rate and the bunker quantity.",
        "Heel is negative to port and positive to starboard.",
        "Under Sequence choose how to distribute the quantity (for example Equal — all storage) and press Fill sequence. Check each target volume and ullage.",
        "Target all to 85% sets every tank to its 85% limit. Edit a target if a tank must stop earlier.",
        "Type the current sounding of each tank as the fuel comes aboard. Clear current soundings empties those boxes.",
        "Current soundings entered as lets you type the tape as dip or as ullage for every tank, or each tank in its own method. You can switch at any time during bunkering: the readings already typed are converted, so the levels do not change.",
        "Press Start pumping when the hose is on. The clock times the operation and watches each tank. Reopen transfer restarts it after a stop.",
        "The valve warning sounds when a tank is near its target. Test alarm sounds it at once so you can check the volume.",
        "Press Finish bunkering at the end of the delivery.",
        "Save only stores the plan; Print & Save stores it and prints; Print only prints without storing. NEW PLAN starts a clean plan."
],
      buttons: [
        "Fill sequence — spreads the quantity over the tanks",
        "Target all to 85% — fills every target to 85%",
        "Clear current soundings — empties the current sounding boxes",
        "Start pumping / Reset / Finish bunkering — the clock",
        "Test alarm — sounds the valve warning now",
        "NEW PLAN — a blank plan"
],
      undo: [
        "A wrong target: change it and the plan recalculates.",
        "Clear current soundings only empties the sounding boxes. Targets and the header stay.",
        "Reset restarts the pumping clock. Save the plan first if you need today's times.",
        "NEW PLAN does not delete saved plans."
]
    },
    {
      group: "Bunkering",
      q: "The valve alarm does not sound, or is too quiet.",
      purpose: "The bunkering plan watches every tank while the clock runs and warns shortly before a tank reaches its target.",
      steps: [
        "Open Bunker Plan and press Test alarm. You should hear the warning and the voice.",
        "Raise the tablet volume with the side keys.",
        "Check the tablet is not on Do Not Disturb or muted by a case button.",
        "Keep the pumping clock running. The watch continues if you move to another Tank page.",
        "Inside ChEng AIO the edge of the screen glows while a tank is inside the warning window, whichever program is open.",
        "If you hear nothing, restart the app and test again. Do not rely on the alarm alone: keep sounding the tanks."
],
      buttons: [
        "Test alarm — sounds the warning now"
],
      undo: [
        "Silencing the alarm does not stop the clock or change the plan."
]
    },
    {
      group: "Bunkering",
      q: "How do I name a saved plan or calculation and find it again?",
      purpose: "When you save a bunkering plan or a consumption plan the program asks for a name or short description. Saved lists have a search box, so an old plan is found by date, name or description.",
      steps: [
        "Press Save, or Save & Print, on the Consumption Plan or the Bunkering Plan.",
        "Type a name or description, for example the voyage or the port. The box can be left empty.",
        "Press Save. Cancel stores nothing.",
        "Scroll to Saved Calculations (consumption plan) or Saved plans (bunkering plan). The new entry is at the top.",
        "Type part of a date, a name, the voyage number or the port in the search box. Only matching rows stay. Clear the box to see them all.",
        "Press Load to bring a saved plan back to the page, Print to reprint it, or Del / Delete to remove it."
],
      buttons: [
        "Save / Save only — stores the plan under a name",
        "Save & Print / Print & Save — stores it, then prints",
        "Print / Print only — prints without storing",
        "Load, Print, Del — on each saved row"
],
      undo: [
        "To rename a saved plan, load it, press Save, and enter the new name.",
        "A deleted saved plan cannot be brought back. Export a backup first if it matters."
]
    },
    {
      group: "Bunkering",
      q: "How are days and quantities worked out in the consumption plan?",
      purpose: "Each line is one leg or stay. The quantity is the daily consumption times the days. The days come from distance and speed unless you type them or the line is a port stay.",
      steps: [
        "Tick P/A for a port or anchorage stay. Distance and speed are then not used; type the days.",
        "For a sea leg type Distance (nm) and Speed (kn). Days = distance ÷ (speed × 24). Clear the distance or the speed and the days clear with them.",
        "You may type the days yourself on a sea leg. That figure is kept until you change the distance or the speed.",
        "On each line pick the Fuel (the vessel's own fuels; Residual and Distillate when none are set up) and type its MT per day. Quantity = MT per day × Days. + Fuel column puts a third fuel on every line.",
        "If Distance, Speed and Days are blank or 0 and both From and To are filled in, the MT per day typed is taken as the quantity for that line.",
        "If From or To is empty and nothing else is entered, the quantity stays empty.",
        "Use Margin % on a line for a reserve on that line only; it applies to every fuel on the line. Add destination / stay adds the next line. Remove last line removes the last one.",
        "Each fuel in use has its own block under the table: enter its Current ROB and Quantity to Receive to see Arrival ROB and Next Departure ROB. Load Voyage ROB or Load Tank ROB fill the ROB for you.",
        "Enter the Delivery / Redelivery ROB to see two excess figures. Excess (Margin) Quantity = Next Departure ROB − Delivery ROB. Excess (Actual) Quantity = ((Current ROB + Quantity to Receive) − Total Consumption) − Delivery ROB, with no margin. A negative figure makes its box glow red.",
        "The result boxes are in three columns with the tablet upright and six sideways. Days are shown to two decimals (for example 3.47); the quantity still uses the exact days.",
        "Saved Calculations is folded away. Tap its heading to open it, then search by date or name."
],
      buttons: [
        "Add destination / stay — next line",
        "Remove last line — takes off the last line",
        "Load Voyage ROB / Load Tank ROB — current ROB from the log or the tanks",
        "Clear — empties the whole plan on screen"
],
      undo: [
        "A figure that looks wrong: check the P/A tick, the distance, the speed, and the days on that line.",
        "Clear asks before it empties the plan. Save the plan first if you may need it again."
]
    },
    {
      group: "Bunkering",
      q: "Clear current soundings did nothing, or a saved plan did not appear.",
      purpose: "Earlier versions did not keep the cleared soundings, and the saved list only refreshed when you left the page.",
      steps: [
        "Open About and check the version. Check for latest release and install the update.",
        "Press Clear current soundings again. The sounding boxes are empty at once and stay empty.",
        "After Save only or Print & Save the saved list refreshes by itself. Open the Saved plans heading if it is folded.",
        "If the search box has text in it, clear it. Search hides rows that do not match.",
        "A plan with no change since the last save is not filed twice; the name is updated on the existing row."
],
      undo: [
        "Nothing is lost by pressing Clear current soundings. Load an earlier saved plan to get its figures back."
]
    },
    {
      group: "Reports",
      q: "How do I convert density, VCF and WCF?",
      purpose: "The VCF / WCF page is a standalone calculator for the ASTM 54B volume correction factor and the Table 56 weight conversion. The same conversion is used on the sounding and bunkering pages.",
      steps: [
        "Open More → VCF/WCF.",
        "Enter the density at 15 °C (or specific gravity) and the temperature.",
        "Read the VCF and the WCF. Density and specific gravity convert both ways.",
        "On a bunkering page enter density @15; without it the quantities cannot be shown in MT."
],
      undo: [
        "A wrong density gives a wrong weight on every tank. Correct the density and save the tank or sheet again."
]
    },
    {
      group: "Reports",
      q: "How do I read the ISO 8217 limits?",
      purpose: "ISO 8217 lists the marine fuel limits for distillate and residual grades.",
      steps: [
        "Open More → ISO 8217.",
        "Choose distillate or residual and find the grade.",
        "Compare the limit with the supplier's analysis on the bunker delivery note."
]
    },
    {
      group: "Problems",
      q: "Tanks do not appear in ChEng AIO, or the e-ORB says Tank Chief has no tanks.",
      purpose: "The e-ORB reads the tank list from Tank Chief of the same ship.",
      steps: [
        "Check the ship in the top bar is the ship you expect.",
        "Open Tanks and look at More → Fuel Oil and Lube Oil. Add Tank adds any tank that is missing.",
        "Open e-ORB → Vessel Setup and press Get fuel & lube oil tanks from Tank Chief.",
        "If Tank Chief is still loading a large ship, wait and press the button again."
],
      buttons: [
        "Add Tank — a tank that is not listed yet"
],
      undo: [
        "Importing tanks into the e-ORB never changes Tank Chief."
]
    },
    {
      group: "Problems",
      q: "How do the Back button and Full screen work on Android?",
      purpose: "Inside ChEng AIO every page you open is remembered, so Back steps back through the pages you visited instead of closing the program. Full screen hides the Android status and navigation bars. It is off until you switch it on.",
      steps: [
        "Press Back (the Android Back button or gesture) to return to the page you were on before.",
        "If the More menu is open, Back closes the menu first.",
        "From the first page, Back shows \"Press Back again to exit\". Press Back again within about two seconds to leave the program.",
        "For full screen open More and press Full screen: Off. It changes to Full screen: On, and the bars hide. Swipe in from the screen edge to bring them back for a moment.",
        "Press the switch again to bring the bars back for good. The choice is remembered.",
        "Back goes through the pages of ChEng AIO. Inside Voyage Chief or Tank Chief, use their own bottom menu to change tabs."
],
      buttons: [
        "Full screen — in More, switches the Android bars off or on",
        "Back — one page back; twice on the first page leaves the program"
],
      undo: [
        "If the bars do not come back, swipe from the top or bottom edge, or turn Full screen off in More.",
        "The switch only shows where the device can do it (the Android app, or Android Chrome)."
]
    },
    {
      group: "Problems",
      q: "A page keeps showing \"Loading…\" or is blank.",
      purpose: "A page opens inside a frame. It shows Loading… while the program before it finishes saving or while the ship is opening. On a big ship, or a slow tablet, that can take a little while.",
      steps: [
        "Wait about ten seconds. The program you left is saving your work, and the next page opens by itself.",
        "If it is still blank, press the same menu button once more.",
        "Open Home and then the page again.",
        "Check that a ship is chosen in the top bar. Choose the ship in Vessel Setup if the bar says No vessel.",
        "Open About and read the version. Press Check for latest release, and install the new app if one is offered.",
        "Last resort: close the app from the Android recent-apps list and open it again. Saved data is kept on the device."
],
      buttons: [
        "Home — the dashboard; a safe page to start again from",
        "Check for latest release — on About"
],
      undo: [
        "Closing and reopening does not delete the ship, the log or the tanks. Export a backup first if you are unsure."
]
    },
    {
      group: "Problems",
      q: "The page is off to one side, has a blank band, or the menu is missing.",
      purpose: "On a tablet held sideways the menu runs down the left edge and the page fills the rest. Held upright the menu is along the bottom. Older versions could leave a blank band beside the menu.",
      steps: [
        "Turn the tablet fully to landscape or portrait and wait a second.",
        "Open About and check the version, then Check for latest release. The band beside the menu was removed in the latest versions.",
        "ECA, Spares, Consumption Plan, Bunkering Plan and e-ORB show the main menu too. Press the menu button of the page you want.",
        "The Bright, Astrolabe and Prism colour button is in the More menu, not at the top.",
        "If it still looks wrong, close the app and open it again."
],
      buttons: [
        "More — the rest of the menu, the colour button and Full screen"
],
      undo: [
        "Layout changes never alter your data."
]
    },
    {
      group: "Problems",
      q: "The keyboard is up and I cannot tap the next box.",
      purpose: "On a tablet the box you tap next must take the keyboard at once. Older versions redrew the table when you left a box, which swallowed the tap.",
      steps: [
        "Tap the next box directly. You no longer have to close the keyboard first.",
        "If a tap still does not land, tap it a second time.",
        "Open About and check the version, then Check for latest release.",
        "The keyboard's down-arrow closes it if it covers a button."
],
      undo: [
        "Nothing is lost when the keyboard closes. Numbers typed are kept."
]
    },
    {
      group: "Problems",
      q: "Printing or saving a file does nothing on Android.",
      purpose: "The Android app prints through the tablet's own print service and saves files into the Downloads folder.",
      steps: [
        "Press Print. Choose a printer, or choose Save as PDF in the print window.",
        "Files such as backups are saved in Downloads/ChEngAIO. The program shows the exact path when it is done.",
        "If nothing opens, wait a few seconds, then press Print once more. Do not press it repeatedly.",
        "Make sure the tablet has a print service installed (Default Print Service), or use Save as PDF.",
        "If you still cannot print, save the PDF and print it from another device."
],
      buttons: [
        "Print — opens the Android print window"
],
      undo: [
        "Printing never changes the record. A Save & Print has already saved it before the print window opens."
]
    },
    {
      group: "Bunkering",
      q: "How do I record the sulphur, LCV and density of a bunkering, tank by tank?",
      purpose: "The delivery note (BDN) gives the sulphur, LCV and density of what was delivered. Tank Chief keeps them for each tank, so Voyage Chief can use the LCV of the fuel actually burned. A tank bunkered empty takes the delivery note as it is; a tank that already held fuel gets the mass-weighted blend of the old fuel and the delivery (density by volume).",
      steps: [
        "After the delivery, open Bunker Summary and enter the delivery note: the BDN number, grade, quantity, density, sulphur and LCV.",
        "Open Bunkering (the survey after delivery). The table lists each tank with Before (MT), Loaded (MT) and After (MT), and the resulting S, LCV, ρ and BDN.",
        "In the last column, a tank that already held fuel with no figures on record shows boxes for BDN, S %, LCV and ρ. Type the figures of the fuel that was already in the tank and the blend follows.",
        "Distillate is normally mixed into whatever is in the tank, so it is blended. Residual is normally put into an empty tank and the BDN stays with that tank.",
        "Save the survey. The tank loads and the monitoring are kept so ChEng AIO can pass them to Voyage Chief."
],
      buttons: [
        "Bunker Summary — the delivery note figures",
        "Bunkering — the survey and the per-tank figures",
        "BDN / S % / LCV / ρ boxes — figures of the fuel already in the tank"
],
      undo: [
        "A wrong figure: reopen the survey, correct the box and save again; the blend is recalculated.",
        "A tank with no prior figures stays unknown until you type them."
]
    },
    {
      group: "Bunkering",
      q: "How does Voyage Chief get the fuel in each tank from Tank Chief?",
      purpose: "Tank Chief records, tank by tank, the figures of each delivery and the latest monitoring. In ChEng AIO Voyage Chief asks for them in the background, so no typing is needed.",
      steps: [
        "Save the bunkering survey and the monitoring in Tank Chief.",
        "Open Voyage Chief in ChEng AIO. It asks Tank Chief for the tanks about every half hour, and again when you press Get fuel from Tank Chief in Setup.",
        "The tanks appear in Fuel in use on the Log Entry and in Setup › Ship Details › Fuel in the storage tanks, with their sulphur, LCV and BDN.",
        "Only storage tanks that hold fuel are offered. Settling, service and overflow tanks are left out.",
        "A tank with no figures can have them typed in Voyage Chief's Setup, on top of the Tank Chief figures."
],
      buttons: [
        "Get fuel from Tank Chief — in Voyage Chief Setup",
        "Save (Bunkering, Monitoring) — in Tank Chief"
],
      undo: [
        "If a tank is missing, open Tank Chief, save the monitoring again, and press Get fuel from Tank Chief."
]
    },
    {
      group: "Bunkering",
      q: "How do I run a bunkering plan on a tank worked by manual interpolation?",
      purpose: "A manual-interpolation tank has no sounding table in the program, so the plan cannot turn a volume into an ullage by itself. You type the figures from the book, and the times and the remainders are calculated as for any tank.",
      steps: [
        "Open Bunker Plan and pick the tank in a slot. The row says the tank is worked by manual interpolation.",
        "The current reading is in m³, not a sounding. Type the volume the tank holds now.",
        "Type the starting ullage and the target ullage in cm yourself. The Interp. button on the row opens the manual interpolation window to work them out from the book.",
        "The quantity to receive, the estimated time and the remaining space are calculated as usual.",
        "While bunkering, type the volume received in m³; the remaining time and quantities follow."
],
      buttons: [
        "Interp. — opens the manual double interpolation window for this tank",
        "Starting / Target ullage (cm) — typed for these tanks"
],
      undo: [
        "Clear the ullage box and retype it, or reopen the manual window."
]
    },
    {
      group: "Soundings",
      q: "How do I use manual double interpolation with the correction method in my book?",
      purpose: "Some sounding books do not give a single table. They give a capacity table and separate trim and heel corrections, in length or in volume, to be applied in a stated order. The manual window lets you type the figures from the book and choose the method that matches it.",
      steps: [
        "Set the tank's calculation to double interpolation (manual) in Add Tank or Calibration. Open the tank and press Double interpolation…. Type the target sounding; the trim and heel used are shown.",
        "Choose the method that matches the book: Volume corrections (m³) — trim table in m³, heel m³ added to it; Heel in cm on the sounding, then trim volume (m³); Trim and heel length corrections together, then volume from the capacity table; Heel first, then trim at the corrected sounding, then volume from the capacity table; or Capacity table with corrections, each in length or volume (m³) added to the volume.",
        "For the last method choose whether the Trim table and the Heel table are a length correction or a volume correction (m³).",
        "When both are length corrections choose the order: both at the sounding as read, trim first then heel, or heel first then trim.",
        "Choose the Sounding unit (cm, mm or m) and the unit the corrections are in.",
        "Type the corner cells and axis ends of each table from the book. The coloured blocks are calculated live. Read the interpolated volume and use it on the sounding."
],
      buttons: [
        "Method radio buttons — the book's arrangement",
        "Trim table is / Heel table is — length or volume",
        "Length corrections — order of trim and heel",
        "Sounding unit / Corrections in"
],
      undo: [
        "A wrong cell: retype it, the blocks recalculate. A wrong method: choose the right button, the figures stay."
]
    },
    {
      group: "Bunkering",
      q: "The LCV is not on my BDN or fuel specs, only “net specific energy”. What do I enter?",
      purpose: "LCV (lower calorific value) is the same quantity as net specific energy, net calorific value or lower heating value. A bunker delivery note often does not show it. The supplier's quality certificate or the independent sample test report gives it as Net specific energy, normally in MJ/kg. Type that figure as it is.",
      steps: [
        "Find Net specific energy on the fuel test report or the supplier's certificate. That is the LCV.",
        "Type it in any LCV box in MJ/kg (for example 40.5) or in kJ/kg (40500). A figure below 100 is read as MJ/kg and converted: 40.5 becomes 40 500 kJ/kg. The box shows the converted figure when you leave it.",
        "Where to type it: Voyage Chief — Receipts (LCV / net specific energy), Setup › Ship Details › Fuel in the storage tanks, and Setup › Bunker LCV. Tank Chief — Bunker Summary (delivery note) and the boxes on After Bunkering.",
        "If you do not have the figure yet, leave the box empty. The entry then uses the Setup LCV for the SFOC, and the line under the tank says so. Nothing is blocked.",
        "For a first estimate the Reference page lists typical values: HFO about 40 000–41 000, VLSFO about 41 000–42 000, MDO about 42 000–43 000, MGO and LSMGO about 42 700 kJ/kg. Replace them with the report's figure when it arrives.",
        "The sulphur content and the density at 15 °C are on the BDN and on the same test report: type them with the LCV."
],
      buttons: [
        "LCV / net specific energy boxes — MJ/kg or kJ/kg",
        "Bunker LCV (Voyage Setup) — used when no tank is chosen or the tank has no LCV"
],
      undo: [
        "A wrong figure: retype it in the same box. Entries already saved keep the figure they were saved with; open the entry, choose the tank again and press Update Entry to refresh it.",
        "A figure typed as 40.5 when you meant 40 500 is the same thing: both are stored as 40 500 kJ/kg."
]
    },
    {
      group: "Bunkering",
      q: "Two fuels came together on one BDN. How do I record the hose and pump times of the second fuel?",
      purpose: "When one barge from one supplier delivers two fuels in one transaction (for example VLSFO and LSMGO on one BDN), each fuel goes through its own hose and its own pump run. The report keeps a second set of hose and pump times for the second fuel, with its own pumping time and rate. Alongside and cast off stay the ship's, once.",
      steps: [
        "Open Bunker Summary. Under Times, fill alongside, connect, pump start, pump stop, disconnect and cast off for the first fuel.",
        "Press + Add second fuel (VLSFO with LSMGO…) in the bunker details. Choose the grade of the second fuel and type its delivery note: BDN number, quantity, sulphur, density and LCV.",
        "A second block appears under Times: Times — second fuel, with its own CONNECT, PUMP START, PUMP STOP and DISCONNECT. Type the date and time of each for the second fuel.",
        "Under each block a line shows the pumping time, the hose-connected time (second fuel) and the average rate once the soundings after bunkering are in. If a stop is before its start, the line says so: check the times.",
        "PRINT & SAVE prints the first fuel's times, then Times — second fuel with the same four events and its pumping time and hose time.",
        "A third or later delivery note is added with + Add extra BDN. It has no separate times: use the second-fuel block for the other grade."
],
      buttons: [
        "+ Add second fuel — gives the second grade its delivery note and its own hose and pump times",
        "Times — second fuel — CONNECT, PUMP START, PUMP STOP, DISCONNECT",
        "Remove second fuel — removes the second note and its times from this report"
],
      undo: [
        "A wrong time: retype it; the pumping time and rate are recalculated.",
        "Remove second fuel takes the second grade and its times off the report. Adding it again starts with empty times.",
        "A summary saved before this change has no second times; open it, add the second fuel, and fill them in."
]
    },
    {
      group: "Bunkering",
      q: "How do I enter two fuels on one voyage, and LSMGO that is burned as needed?",
      purpose: "The route is typed once. Each line then carries the fuels burned on it, each with its own MT per day, so a second fuel needs no second table. A fuel used as demand arises, such as LSMGO, is entered as its average MT per day.",
      steps: [
        "Type each destination or stay as one line: From, To, distance and speed (or the days for a port stay).",
        "On the line pick Fuel 1, for example HFO, and type its MT per day. Pick Fuel 2, for example LSMGO, and type its MT per day. The fuels offered are the grades of the vessel's fuel tanks; with none set up they are Residual and Distillate.",
        "A fuel burned as needed (LSMGO for generators, boiler or other uses) is typed as its average MT per day. The plan multiplies it by the days of the line like any other fuel. Leave the box empty on a line where it is not burned.",
        "For a fuel changeover during the voyage use two lines, before and after, and pick the different fuel on each line.",
        "+ Fuel column adds a third fuel to every line (up to four); − Fuel column takes the last one off.",
        "The days and the distance are worked out once. Below the table each fuel has its own block: Current ROB, Quantity to Receive, unpumpable, weather reserve, Delivery ROB, the result boxes and the stem advice.",
        "The margin % of a line applies to every fuel on that line.",
        "A calculation saved with the earlier layout opens converted: its residual and distillate figures sit side by side on the same lines."
],
      buttons: [
        "Fuel 1 / Fuel 2 — the fuel picked from the vessel's grades, with its MT per day",
        "+ Fuel column / − Fuel column — another fuel on every line",
        "Add destination / stay, Remove last line — the lines of the route"
],
      undo: [
        "A wrong fuel on a line: pick the right one in that box; the totals move to it.",
        "A fuel column with figures asks before it is removed."
]
    },
    {
      group: "Bunkering",
      q: "How do I plan two voyage legs one after the other in the consumption plan?",
      purpose: "A voyage that follows another is added as a next voyage leg. It has its own route and quantities, starts with the ROB the leg before it ends with, and every leg is shown side by side with the combined total.",
      steps: [
        "Fill in leg 1 as usual: its route lines, fuels and MT per day, Current ROB and Quantity to Receive.",
        "Press + Next voyage leg. Leg 2 appears below with its own route lines; its fuels start as the last line of leg 1 used.",
        "Type leg 2's route, fuels and MT per day. Its Current ROB cannot be typed: it is the Next Departure ROB of leg 1, so a change in leg 1 moves leg 2 at once.",
        "Quantity to Receive, unpumpable, weather reserve and delivery ROB are kept for each leg, because each leg ends at its own port.",
        "Give a leg a name (optional) to recognise it, for example Singapore → Rotterdam.",
        "The table All voyage legs side by side shows, for every leg and for the combined total: days at port and at sea, distance, and for each fuel the starting ROB, consumption, margin, required quantity, quantity to receive, arrival ROB, next departure ROB and the stem still needed. A shortage shows in red and carries into the next leg.",
        "Combined: days, distance, consumption, margin, required quantity and quantity to receive are added up; the starting ROB is that of leg 1; the arrival, next departure ROB and stem are those at the end of the last leg.",
        "Print and Save & Print give each leg its own pages followed by the combined total. Up to six legs can be planned."
],
      buttons: [
        "+ Next voyage leg — add a leg that continues from the one above",
        "− Last voyage leg — take off the last leg (asks first when it has figures)",
        "Leg name — an optional label shown in the table and the printout"
],
      undo: [
        "A leg added by mistake: − Last voyage leg removes it.",
        "A calculation with one leg looks and prints exactly as before."
]
    },
    {
      group: "Bunkering",
      q: "How do I get the distance of a voyage line automatically, and avoid a canal or an area?",
      purpose: "The consumption plan can work out the distance between two ports offline, from a built-in list of ports and a network of sea lanes. It is a planning estimate, not for navigation.",
      steps: [
        "On a sea line, type a few letters of the From port and pick it from the list; do the same for To. The distance is filled in at once and shown in italics with a dashed border.",
        "The days follow from the distance and the speed you type, and the quantities follow from the days, as for any other line.",
        "Under the table, Distance from ports · route options lets you avoid passages (Suez, Panama, Bab-el-Mandeb, Malacca, Hormuz, Cape of Good Hope and others) and keep out of areas (Gulf of Aden, Red Sea, Somali Basin, Gulf of Guinea, Black Sea, Taiwan Strait). The areas are approximate boxes that you choose; they are not official designations.",
        "Changing an option recalculates the automatic distances. Press Recalculate automatic distances to do it again by hand.",
        "A distance you type yourself is never replaced. Typing over an automatic distance makes it yours.",
        "A note under the line says which passages the route uses. A warning appears when the From or To port is inside an avoided area, or far from the nearest sea lane.",
        "Approach: published distance tables often run from pilot station to pilot station. Under Route options, Add N nm at each end adds a port-approach allowance to every automatic distance (empty = the shortest route).",
  "Shortest route: the distance follows a network of sea lanes and is then shortened with great-circle legs wherever the sea is open (checked against a generalised coastline, keeping clear of land, never through a canal or a passage you chose to avoid). Open water gives the great circle itself; the note says how many nm the great-circle legs saved. Untick Shortest route under Route options to see the lane distance. Weather, currents and traffic schemes are not considered.",
  "The route map is printed on its own page after the plan (tick or untick Include the route map on the printout under Route options).",
  "ECA: when the automatic route passes through an Emission Control Area, the note under the line says how many nm are inside (for example Mediterranean 1,935 nm, North Sea & English Channel 418 nm), and a Distance in ECA box appears beside the distance boxes. North America, US Caribbean and the North-East Atlantic follow the coordinates in the IMO resolutions; Baltic, North Sea & English Channel and Mediterranean are drawn from the wording of the regulations. The North-East Atlantic ECA was adopted on 1 May 2026 and is expected to enter into force on 1 September 2027, so it is counted only for a plan dated on or after that day, or when you tick it under Route options. You can switch any zone off there. Canadian Arctic and Norwegian Sea are not included.",
  "Split into ECA / non-ECA lines (button in the note) replaces the line by one line per stretch, each with its own distance, days and quantity. Under Route options, Fuel 1 on the ECA lines becomes lets you pick the compliant fuel for those lines (for example LSMGO). MT/day, speed and margin carry over; check them. Split lines are not recalculated when you change the route options.",
  "Map: the Map button on a line's note, or Show map of all lines under Route options, opens the route on an offline map: the route in colour (one colour per voyage leg), the ECA stretches in orange, the ports, the passages it uses, and the ECA zones and the areas you chose to avoid shaded. Drag to move, pinch or scroll to zoom, Fit to see the whole route. It is a planning picture from a generalised coastline (Natural Earth, public domain), not a chart.",
  "The printout marks automatic distances with * and says how they were made. Arctic routes are never used.",
        "The port list is the NGA World Port Index (3,669 ports, edition of 2017). Compare with your own passage plan or distance tables before relying on a figure."
],
      buttons: [
        "Route options — avoid passages and areas",
        "Recalculate automatic distances — redo all lines whose distance is automatic"
],
      undo: [
        "Wrong port picked: pick another; the distance follows.",
        "Do not want the automatic figure: type your own distance."
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

  /* Search: every word must be found somewhere in a topic (any order); best matches first; related words
     (for example "calorific" finds LCV) are matched too. When no topic has all the words, the closest ones are shown. */
  const SYNONYMS = {
    lcv: 'calorific heating value energy net specific energy mj/kg kj/kg sfoc', sulphur: 'sulfur s% sox', sulfur: 'sulphur', bdn: 'bunker delivery note',
    blend: 'mix mixed mixing', ullage: 'dip sounding', sounding: 'ullage dip', empty: 'low run out estimate estimated',
    receipt: 'bunker delivery received receipts', interpolation: 'interpolate table book correction trim heel',
    eca: 'seca emission control area changeover', seca: 'eca', 'mt/hr': 'consumption rate hourly', rob: 'remaining on board stock',
    backup: 'restore export save', delete: 'remove erase', edit: 'change correct amend fix', correct: 'edit fix amend change',
    density: 'sg specific gravity', warning: 'alert alarm', print: 'printout pdf'
  };
  function guideHay(item) {
    const base = [item.group, item.q, item.purpose].concat(item.steps || [], item.buttons || [], item.undo || []).join(' ').toLowerCase();
    let extra = '';
    Object.keys(SYNONYMS).forEach((k) => { if (base.indexOf(k) !== -1) extra += ' ' + SYNONYMS[k]; });
    return { base: base, extra: extra };
  }
  function guideSearch(items, query) {
    const tokens = String(query || '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
    if (!tokens.length) return { list: items.slice(), tokens: tokens, partial: false };
    const scored = items.map((item) => {
      const h = item._h || (item._h = guideHay(item));
      const title = String(item.q).toLowerCase(), grp = String(item.group).toLowerCase(), pur = String(item.purpose).toLowerCase();
      let score = 0, hits = 0;
      tokens.forEach((t) => {
        let s = 0;
        if (title.indexOf(t) !== -1) s += 6;
        if (grp.indexOf(t) !== -1) s += 3;
        if (pur.indexOf(t) !== -1) s += 2;
        if (h.base.indexOf(t) !== -1) s += 1; else if (h.extra.indexOf(t) !== -1) s += 0.5;
        if (s > 0) hits++;
        score += s;
      });
      return { item: item, score: score, hits: hits };
    });
    let found = scored.filter((x) => x.hits === tokens.length);
    let partial = false;
    if (!found.length) { found = scored.filter((x) => x.hits > 0); partial = true; }
    found.sort((a, b) => b.score - a.score);
    return { list: found.map((x) => x.item), tokens: tokens, partial: partial };
  }
  function guideMark(escaped, tokens) {
    let out = escaped;
    (tokens || []).forEach((t) => {
      const e = esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!e) return;
      out = out.replace(new RegExp('(?![^<]*>)(' + e + ')', 'gi'), '<mark style="background:rgba(255,200,80,.38);color:inherit;border-radius:3px;padding:0 1px">$1</mark>');
    });
    return out;
  }

  function render(host) {
    if (!host) return;
    ensureStyle();
    const groups = ['All'].concat(ITEMS.map((item) => item.group).filter((name, i, all) => all.indexOf(name) === i));
    host.innerHTML =
      '<h2>How to operate</h2>' +
      '<p>Search a question. Each answer says what the job is for, the steps, what the buttons do, and how to undo a mistake.</p>' +
      '<label for="tankGuideSearch">Search the guide</label>' +
      '<input id="tankGuideSearch" class="op-guide-search" type="search" placeholder="Search (press /), e.g. lcv sulphur, edit receipt, empty tank, interpolation, eca mt/hr" autocomplete="off">' +
      '<button type="button" class="op-guide-clear" id="tankGuideClear" hidden style="margin-left:6px;">Clear</button>' +
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
    const clearBtn = host.querySelector('#tankGuideClear');
    function draw() {
      const qraw = search.value.trim();
      const pool = ITEMS.filter((item) => active === 'All' || item.group === active);
      const res = guideSearch(pool, qraw);
      const shown = res.list, toks = res.tokens;
      if (clearBtn) clearBtn.hidden = !qraw;
      if (!shown.length) {
        listEl.innerHTML = '<p class="hint">Nothing matches. Try fewer words, or sounding, bunker, lcv, interpolation, or backup.</p>';
      } else {
        let html = '';
        let last = '';
        if (qraw && res.partial) html += '<p class="hint">No topic has all those words. These are the closest, matching some of them:</p>';
        shown.forEach((item) => {
          if (!qraw && item.group !== last) {
            html += '<h3 class="op-guide-sub">' + esc(item.group) + '</h3>';
            last = item.group;
          }
          html += '<details class="op-guide-item"' + (qraw && shown.length <= 3 ? ' open' : '') + '><summary>' + guideMark(esc(item.q), toks) +
            (qraw ? ' <small style="opacity:.65;">· ' + esc(item.group) + '</small>' : '') + '</summary>' +
            '<p class="op-guide-purpose">' + guideMark(esc(item.purpose), toks) + '</p>' +
            list('Steps', item.steps) + list('Buttons', item.buttons) + list('If this was a mistake', item.undo) +
            '</details>';
        });
        listEl.innerHTML = html;
      }
      countEl.textContent = shown.length + (shown.length === 1 ? ' topic' : ' topics') + (qraw ? (res.partial ? ' partly match the search.' : ' match the search, best first.') : ' in this list.');
    }
    if (clearBtn) clearBtn.addEventListener('click', () => { search.value = ''; draw(); search.focus(); });
    search.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && search.value) { search.value = ''; draw(); } });
    /* "/" or Ctrl+K jumps to the search box while this guide is on screen (not while typing in another box). */
    if (!host.dataset.searchKey) {
      host.dataset.searchKey = '1';
      document.addEventListener('keydown', (ev) => {
        if (!host.isConnected || !host.offsetParent) return;
        const t = ev.target, tag = t && t.tagName;
        const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
        if ((ev.key === '/' && !typing && !ev.ctrlKey && !ev.metaKey && !ev.altKey) || ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k')) {
          ev.preventDefault(); search.focus(); search.select();
        }
      });
    }
    search.addEventListener('input', draw);
    draw();
  }

  window.TankGuide = { render: render, items: ITEMS };
})();
