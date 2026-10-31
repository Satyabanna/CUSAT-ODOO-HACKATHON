// Minimal, safe bridge: lets the invoice print page save itself as a PDF.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('brightloop', {
  savePdf: name => ipcRenderer.invoke('save-pdf', name),
});
