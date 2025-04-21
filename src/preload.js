// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

// src/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  login: (username, password) => ipcRenderer.invoke('login', username, password),
  createRepository: () => ipcRenderer.invoke('create-repo'), 
  makeCommit: (repoPath, message) => ipcRenderer.invoke('make-commit', repoPath, message),
  getLog: (repoPath) => ipcRenderer.invoke('get-log', repoPath),
  getCommitFiles: (repoPath, commitId) => ipcRenderer.invoke('get-commit-files', repoPath, commitId),
  getBlobContent: (repoPath, fileHash) => ipcRenderer.invoke('get-blob-content', repoPath, fileHash),
  getCurrentFileContent: (repoPath, filePath) => ipcRenderer.invoke('get-current-file-content', repoPath, filePath),
  checkoutCommit: (repoPath, commitId) => ipcRenderer.invoke('checkout-commit', repoPath, commitId),

});
console.log('Preload script loaded.');