/**
 * Electron preload — exposes a safe desktop save bridge to the renderer.
 * File System Access API (showSaveFilePicker) crashes Electron's renderer on
 * write; backups/exports must go through this IPC path instead.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ChengDesktopFiles', {
  /**
   * @returns {Promise<string>} Absolute path written, or '' if the user cancelled.
   */
  saveText(filename, text, mime) {
    return ipcRenderer.invoke('cheng-save-text', {
      filename: String(filename || ''),
      text: String(text ?? ''),
      mime: String(mime || 'application/json'),
    });
  },
});

/** Notes: alarms rung by the desktop app, and the calendar hand-off. */
contextBridge.exposeInMainWorld('ChengDesktopReminders', {
  sync(list) {
    return ipcRenderer.invoke('cheng-reminders-sync', Array.isArray(list) ? list : []);
  },
  /** @returns {Promise<string>} The calendar file that was opened, or '' if it could not be. */
  openCalendar(filename, text) {
    return ipcRenderer.invoke('cheng-reminders-calendar', {
      filename: String(filename || ''),
      text: String(text ?? ''),
    });
  },
});
