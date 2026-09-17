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
