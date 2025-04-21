
const { app, BrowserWindow, ipcMain, dialog } = require('electron'); 
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs'); 
const fs = require('fs');
const crypto = require('crypto'); 


const dbPath = path.join(app.getPath('userData'), 'app_database.db');
console.log('Database path:', dbPath);
let db; 

function initializeDatabase() {
  try {
    db = new Database(dbPath, { verbose: console.log });
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
      );
    `);
    console.log('Users table checked/created.');

    const checkUserStmt = db.prepare('SELECT COUNT(*) as count FROM users WHERE username = ?');
    const userExists = checkUserStmt.get('testuser').count > 0;

    if (!userExists) {
      const saltRounds = 10;
      const testPassword = 'password123';
      
      bcrypt.hash(testPassword, saltRounds, (err, hash) => {
        if (err) {
          console.error('Error hashing password:', err);
          return;
        }
        try {
          const insertStmt = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
          insertStmt.run('testuser', hash);
          console.log('Sample user "testuser" created.');
        } catch (insertErr) {
          if (!insertErr.message.includes('UNIQUE constraint failed')) {
             console.error('Error inserting sample user:', insertErr);
          } else {
             console.log('Sample user "testuser" already exists (handled race condition).');
          }
        }
      });
    } else {
      console.log('Sample user "testuser" already exists.');
    }

  } catch (err) {
    console.error('Database initialization failed:', err);
    app.quit();
  }
}


if (require('electron-squirrel-startup')) {
  app.quit();
}

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY, 
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY); 
  mainWindow.webContents.openDevTools();
};


app.on('ready', () => {
  initializeDatabase();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (db) {
      db.close((err) => { 
        if (err) console.error('Failed to close main database:', err.message);
        else console.log('Main database connection closed.');
      });
    }
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});



ipcMain.handle('login', async (event, username, password) => {
  console.log(`IPC Handler: Login attempt for user: ${username}`);
  if (!db) {
      console.error('IPC Handler: Main database not initialized!');
      return { success: false, message: 'Database connection error.' };
  }
  try {
    const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
    console.log(`IPC Handler: Querying main DB for user: ${username}`);
    const user = stmt.get(username);
    console.log('IPC Handler: User found in main DB:', user ? 'Yes' : 'No');

    if (!user) {
      console.log('IPC Handler: Login failed - User not found.');
      return { success: false, message: 'Invalid username or password.' };
    }

    console.log(`IPC Handler: Comparing provided password with hash: ${user.password_hash}`);
    
    const match = await bcrypt.compare(String(password || ''), user.password_hash);
    console.log('IPC Handler: Password match result:', match);

    if (match) {
      console.log('IPC Handler: Login successful for user:', username);
      return { success: true, message: 'Login successful!', username: user.username };
    } else {
      console.log('IPC Handler: Login failed - Password mismatch.');
      return { success: false, message: 'Invalid username or password.' };
    }
  } catch (error) {
    console.error('IPC Handler: Error during login process:', error);
    return { success: false, message: 'An internal error occurred.' };
  }
});

ipcMain.handle('create-repo', async () => {
  console.log('IPC Handler: create-repo invoked');
  const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) {
      console.log('IPC Handler: Folder selection cancelled.');
      return { success: false, message: 'No folder selected.' };
  }

  const folderPath = result.filePaths[0];
  const vcsDir = path.join(folderPath, '.myvcs');
  console.log(`IPC Handler: Target repo path: ${folderPath}, VCS dir: ${vcsDir}`);

  let repoDb = null; 
  try {
      if (!fs.existsSync(vcsDir)) {
          console.log(`IPC Handler: Creating directory ${vcsDir}`);
          fs.mkdirSync(vcsDir);
      } else {
          console.log(`IPC Handler: Directory ${vcsDir} already exists.`);
      }

      
      const repoDbPath = path.join(vcsDir, 'db.sqlite');
      console.log(`IPC Handler: Initializing repo DB at ${repoDbPath}`);
      
      const RepoDatabase = require('better-sqlite3');
      repoDb = new RepoDatabase(repoDbPath); 
      repoDb.exec(`
        CREATE TABLE IF NOT EXISTS commits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            message TEXT
        );
    `);

    
    repoDb.exec(`
        CREATE TABLE IF NOT EXISTS blobs (
            hash TEXT PRIMARY KEY NOT NULL, -- The unique hash identifies the content
            content BLOB NOT NULL          -- Store content as a Binary Large Object (BLOB)
        );
    `);

    
    repoDb.exec(`
        CREATE TABLE IF NOT EXISTS commit_files (
            commit_id INTEGER NOT NULL,    -- Foreign key to commits table
            path TEXT NOT NULL,            -- Relative path of the file
            hash TEXT NOT NULL,            -- Foreign key to blobs table (the content hash)
            PRIMARY KEY (commit_id, path), -- A file path can only appear once per commit
            FOREIGN KEY (commit_id) REFERENCES commits(id),
            FOREIGN KEY (hash) REFERENCES blobs(hash)
        );
    `);
    console.log('IPC Handler: Repo DB tables (commits, blobs, commit_files) checked/created.');
    repoDb.close(); 
    console.log('IPC Handler: Repo DB connection closed after init.');

    return { success: true, path: folderPath };
  } catch (err) {
      console.error('IPC Handler: Error creating repo:', err);
      if (repoDb) { 
          try { repoDb.close(); } catch (closeErr) { console.error('Error closing repo DB after error:', closeErr); }
      }
      return { success: false, message: `Failed to create repository: ${err.message}` };
  }
});




function getAllFiles(dirPath, repoRoot, arrayOfFiles = []) {
  console.log(`[getAllFiles] Scanning directory: ${dirPath}`); 
  console.log(`[getAllFiles] Repository root: ${repoRoot}`);

  let files = [];
  try {
      files = fs.readdirSync(dirPath); 
      console.log(`[getAllFiles] Found items in ${dirPath}:`, files);
  } catch (err) {
      console.error(`[getAllFiles] Error reading directory ${dirPath}:`, err.message);
      return arrayOfFiles; 
  }

  for (const file of files) {
      const absoluteFilePath = path.join(dirPath, file);
      console.log(`[getAllFiles] Processing item: ${absoluteFilePath}`);

      
      const vcsDirPath = path.join(repoRoot, '.myvcs');
      if (absoluteFilePath.startsWith(vcsDirPath)) {
          console.log(`[getAllFiles] Skipping VCS directory item: ${absoluteFilePath}`);
          continue; 
      }

      
      let stats;
      try {
          stats = fs.statSync(absoluteFilePath); 
      } catch (statErr) {
          console.error(`[getAllFiles] Error getting stats for ${absoluteFilePath}:`, statErr.message);
          continue; 
      }

      
      if (stats.isDirectory()) {
          console.log(`[getAllFiles] Recursing into directory: ${absoluteFilePath}`);
          getAllFiles(absoluteFilePath, repoRoot, arrayOfFiles); 
      } else if (stats.isFile()) {
          console.log(`[getAllFiles] Adding file to list: ${absoluteFilePath}`);
          arrayOfFiles.push(absoluteFilePath); 
      } else {
          console.log(`[getAllFiles] Skipping item (not file or directory): ${absoluteFilePath}`);
      }
  }

  
  return arrayOfFiles;
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}


ipcMain.handle('make-commit', async (event, repoPath, message) => {
   console.log(`IPC Handler: make-commit invoked for repo: ${repoPath}`);
   if (!repoPath) {
       return { success: false, message: 'Repository path is missing.' };
   }

   const vcsPath = path.join(repoPath, '.myvcs');
   const dbPath = path.join(vcsPath, 'db.sqlite');

   if (!fs.existsSync(dbPath)) {
       return { success: false, message: 'Repository database not found. Has the repo been initialized?' };
   }

   let commitDb = null;
   try {
       console.log(`IPC Handler: Opening commit DB at ${dbPath}`);
       const CommitDatabase = require('better-sqlite3');
       commitDb = new CommitDatabase(dbPath);
       commitDb.pragma('journal_mode = WAL');

       const files = getAllFiles(repoPath, repoPath); 
       const commitTime = new Date().toISOString();
       const filesInCommit = []; 

       console.log(`IPC Handler: Found ${files.length} files to consider for commit.`);

commitDb.exec(`
  CREATE TABLE IF NOT EXISTS commits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      message TEXT
  );
`);
commitDb.exec(`
  CREATE TABLE IF NOT EXISTS blobs (
      hash TEXT PRIMARY KEY NOT NULL,
      content BLOB NOT NULL
  );
`);
commitDb.exec(`
  CREATE TABLE IF NOT EXISTS commit_files (
      commit_id INTEGER NOT NULL,
      path TEXT NOT NULL,
      hash TEXT NOT NULL,
      PRIMARY KEY (commit_id, path),
      FOREIGN KEY (commit_id) REFERENCES commits(id),
      FOREIGN KEY (hash) REFERENCES blobs(hash)
  );
`);

       
       
       
       
       console.log("IPC Handler: Note - Currently committing all scanned files, not calculating diff from parent yet.");


       
       commitDb.exec('BEGIN');

       
       const insertCommit = commitDb.prepare(`INSERT INTO commits (timestamp, message) VALUES (?, ?)`);
       const commitInfo = insertCommit.run(commitTime, message);
       const commitId = commitInfo.lastInsertRowid;
       console.log(`IPC Handler: Created commit entry with ID: ${commitId}`);

       
       
       const insertBlob = commitDb.prepare(`INSERT OR IGNORE INTO blobs (hash, content) VALUES (?, ?)`);
       const insertCommitFile = commitDb.prepare(`INSERT INTO commit_files (commit_id, path, hash) VALUES (?, ?, ?)`);

       
       for (const file of files) {
           const relativePath = path.relative(repoPath, file);
           try {
               const content = fs.readFileSync(file); 
               const hash = hashContent(content);

               
               
               const blobInsertInfo = insertBlob.run(hash, content);
               if (blobInsertInfo.changes > 0) {
                    console.log(`IPC Handler: Inserted new blob for hash: ${hash.substring(0, 8)}...`);
               }

               
               insertCommitFile.run(commitId, relativePath, hash);
               filesInCommit.push({ file: relativePath, hash: hash }); 

           } catch (readFileError) {
               console.error(`IPC Handler: Error reading file ${relativePath}: ${readFileError.message}. Skipping.`);
               
           }
       }

       commitDb.exec('COMMIT'); 
       console.log(`IPC Handler: Commit transaction finished.`);
       commitDb.close(); 
       console.log('IPC Handler: Commit DB connection closed.');

       
       return { success: true, message: `Commit ${commitId} successful. Snapshot includes ${filesInCommit.length} file(s).`, files: filesInCommit };

   } catch (err) {
       console.error('IPC Handler: Commit error:', err);
       if (commitDb) {
           try {
               console.log('IPC Handler: Rolling back commit transaction due to error.');
               commitDb.exec('ROLLBACK');
               commitDb.close();
               console.log('IPC Handler: Commit DB connection closed after rollback.');
           } catch (rollbackErr) {
               console.error('IPC Handler: Error rolling back or closing DB after commit error:', rollbackErr);
                if(commitDb && commitDb.open) {
                    try { commitDb.close(); } catch(e){ console.error("Error force closing commit DB:", e); }
                }
           }
       }
       return { success: false, message: `Commit failed: ${err.message}` };
   }
});


ipcMain.handle('get-log', async (event, repoPath) => {
  console.log(`IPC Handler: get-log invoked for repo: ${repoPath}`);
  if (!repoPath) {
      return { success: false, message: 'Repository path is missing.', logs: [] };
  }

  const vcsPath = path.join(repoPath, '.myvcs');
  const dbPath = path.join(vcsPath, 'db.sqlite');

  if (!fs.existsSync(dbPath)) {
      console.log(`IPC Handler: Log failed - DB not found at ${dbPath}`);
      return { success: false, message: 'Repository database not found. Has the repo been initialized?', logs: [] };
  }

  let logDb = null; 
  try {
      console.log(`IPC Handler: Opening log DB at ${dbPath}`);
      const LogDatabase = require('better-sqlite3');
      logDb = new LogDatabase(dbPath, { readonly: true }); 
      logDb.pragma('journal_mode = WAL'); 

      
      const stmt = logDb.prepare(`
          SELECT id, timestamp, message
          FROM commits
          ORDER BY timestamp DESC
      `);

      const logs = stmt.all(); 

      logDb.close(); 
      console.log(`IPC Handler: Log DB connection closed. Found ${logs.length} commits.`);

      return { success: true, logs: logs }; 

  } catch (err) {
      console.error('IPC Handler: Error getting log:', err);
      if (logDb) { 
           try { logDb.close(); } catch (closeErr) { console.error('Error closing log DB after error:', closeErr); }
      }
      return { success: false, message: `Failed to get log: ${err.message}`, logs: [] };
  }
});


ipcMain.handle('checkout-commit', async (event, repoPath, commitId) => {
  console.log(`IPC Handler: checkout-commit invoked for repo: ${repoPath}, commitId: ${commitId}`);
  if (!repoPath || commitId === undefined || commitId === null) {
      return { success: false, message: 'Repository path or Commit ID is missing.' };
  }

  const vcsPath = path.join(repoPath, '.myvcs');
  const dbPath = path.join(vcsPath, 'db.sqlite');

  if (!fs.existsSync(dbPath)) {
      console.log(`IPC Handler: Checkout failed - DB not found at ${dbPath}`);
      return { success: false, message: 'Repository database not found.' };
  }

  let checkoutDb = null;
  try {
      console.log(`IPC Handler: Opening checkout DB at ${dbPath}`);
      
      const CheckoutDatabase = require('better-sqlite3');
      checkoutDb = new CheckoutDatabase(dbPath);
      checkoutDb.pragma('journal_mode = WAL');

      
      const getCommitFilesStmt = checkoutDb.prepare(`
          SELECT path, hash FROM commit_files WHERE commit_id = ?
      `);
      const targetFiles = getCommitFilesStmt.all(commitId); 

      if (targetFiles.length === 0) {
           
           const commitExistsStmt = checkoutDb.prepare('SELECT 1 FROM commits WHERE id = ?');
           const commitExists = commitExistsStmt.get(commitId);
           if (!commitExists) {
               throw new Error(`Commit ID ${commitId} not found.`);
           }
           
           console.log(`IPC Handler: Target commit ${commitId} has no files associated with it.`);
      } else {
           console.log(`IPC Handler: Found ${targetFiles.length} files in target commit ${commitId}.`);
      }


      
      const getBlobStmt = checkoutDb.prepare('SELECT content FROM blobs WHERE hash = ?');
      const filesToWrite = []; 
      for (const file of targetFiles) {
          const blob = getBlobStmt.get(file.hash);
          if (!blob) {
              
              throw new Error(`Blob content not found for hash ${file.hash} (associated with path ${file.path} in commit ${commitId}).`);
          }
          const absolutePath = path.join(repoPath, file.path);
          filesToWrite.push({ absolutePath: absolutePath, content: blob.content });
      }

      
      
      const currentFilesRaw = getAllFiles(repoPath, repoPath); 
      const currentFilesAbsolute = new Set(currentFilesRaw); 

      
      console.warn(`IPC Handler: WARNING - Checking out commit ${commitId}. This will overwrite/delete files in the working directory: ${repoPath}`);

      
      let filesWritten = 0;
      for (const fileInfo of filesToWrite) {
          try {
              
              const dirName = path.dirname(fileInfo.absolutePath);
              fs.mkdirSync(dirName, { recursive: true }); 

              
              fs.writeFileSync(fileInfo.absolutePath, fileInfo.content); 
              filesWritten++;
              console.log(`IPC Handler: Wrote file: ${fileInfo.absolutePath}`);
              
              currentFilesAbsolute.delete(fileInfo.absolutePath);
          } catch (writeErr) {
              throw new Error(`Failed to write file ${fileInfo.absolutePath}: ${writeErr.message}`);
          }
      }

      
      let filesDeleted = 0;
      for (const fileToDelete of currentFilesAbsolute) {
          
           const vcsDirPath = path.join(repoPath, '.myvcs');
           if (fileToDelete.startsWith(vcsDirPath)) {
              continue;
           }

          try {
              console.log(`IPC Handler: Deleting file not in target commit: ${fileToDelete}`);
              fs.unlinkSync(fileToDelete); 
              filesDeleted++;
          } catch (deleteErr) {
               
               if (deleteErr.code !== 'ENOENT') {
                  console.error(`IPC Handler: Failed to delete file ${fileToDelete}: ${deleteErr.message}`);
                  
               }
          }
      }
      

      checkoutDb.close();
      console.log(`IPC Handler: Checkout DB connection closed. Wrote ${filesWritten} files, deleted ${filesDeleted} files.`);

      return { success: true, message: `Successfully checked out commit ${commitId}. Wrote ${filesWritten} files, deleted ${filesDeleted} files.` };

  } catch (err) {
      console.error('IPC Handler: Error during checkout:', err);
      if (checkoutDb) {
          try { checkoutDb.close(); } catch (closeErr) { console.error('Error closing checkout DB after error:', closeErr); }
      }
      return { success: false, message: `Checkout failed: ${err.message}` };
  }
});
ipcMain.handle('get-commit-files', async (event, repoPath, commitId) => {
    console.log(`IPC Handler: get-commit-files for repo: ${repoPath}, commitId: ${commitId}`);
    if (!repoPath || commitId === undefined || commitId === null) {
      return { success: false, message: 'Repository path or Commit ID is missing.', files: [] };
    }
  
    const vcsPath = path.join(repoPath, '.myvcs');
    const dbPath = path.join(vcsPath, 'db.sqlite');
  
    if (!fs.existsSync(dbPath)) {
      console.log(`IPC Handler: Get commit files failed - DB not found at ${dbPath}`);
      return { success: false, message: 'Repository database not found.', files: [] };
    }
  
    let commitFilesDb = null;
    try {
      console.log(`IPC Handler: Opening commit files DB at ${dbPath}`);
      const CommitFilesDatabase = require('better-sqlite3');
      commitFilesDb = new CommitFilesDatabase(dbPath, { readonly: true });
      commitFilesDb.pragma('journal_mode = WAL');
  
      const stmt = commitFilesDb.prepare(`
          SELECT path, hash
          FROM commit_files
          WHERE commit_id = ?
          ORDER BY path ASC
      `);
  
      const files = stmt.all(commitId);
  
      commitFilesDb.close();
      console.log(`IPC Handler: Commit files DB closed. Found ${files.length} files for commit ${commitId}.`);
  
      return { success: true, files: files };
  
    } catch (err) {
      console.error('IPC Handler: Error getting commit files:', err);
      if (commitFilesDb) {
        try { commitFilesDb.close(); } catch (closeErr) { console.error('Error closing commit files DB after error:', closeErr); }
      }
      return { success: false, message: `Failed to get files for commit ${commitId}: ${err.message}`, files: [] };
    }
  });
  
  ipcMain.handle('get-blob-content', async (event, repoPath, fileHash) => {
    console.log(`IPC Handler: get-blob-content for repo: ${repoPath}, hash: ${fileHash}`);
     if (!repoPath || !fileHash) {
      return { success: false, message: 'Repository path or file hash is missing.' };
    }
    const vcsPath = path.join(repoPath, '.myvcs');
    const dbPath = path.join(vcsPath, 'db.sqlite');
  
    if (!fs.existsSync(dbPath)) {
      return { success: false, message: 'Repository database not found.' };
    }
  
    let blobDb = null;
    try {
      const BlobDatabase = require('better-sqlite3');
      blobDb = new BlobDatabase(dbPath, { readonly: true });
      blobDb.pragma('journal_mode = WAL');
  
      const stmt = blobDb.prepare('SELECT content FROM blobs WHERE hash = ?');
      const blob = stmt.get(fileHash);
      blobDb.close();
  
      if (!blob) {
          return { success: false, message: `Blob content not found for hash ${fileHash}` };
      }
      // Assuming content is stored as BLOB, convert to UTF-8 string for diffing
      const contentString = Buffer.from(blob.content).toString('utf-8');
      return { success: true, content: contentString };
  
    } catch (err) {
      console.error('IPC Handler: Error getting blob content:', err);
       if (blobDb) { try { blobDb.close(); } catch (e) {} }
      return { success: false, message: `Failed to get blob content: ${err.message}` };
    }
  });
  
  ipcMain.handle('get-current-file-content', async (event, repoPath, filePath) => {
    console.log(`IPC Handler: get-current-file-content for repo: ${repoPath}, file: ${filePath}`);
    if (!repoPath || !filePath) {
      return { success: false, message: 'Repository path or file path is missing.' };
    }
    const absolutePath = path.join(repoPath, filePath);
    try {
      // Read file as UTF-8 string
      const content = fs.readFileSync(absolutePath, { encoding: 'utf-8' });
      return { success: true, content: content };
    } catch (err) {
      if (err.code === 'ENOENT') { // File doesn't exist in working directory
          return { success: true, content: '' }; // Treat non-existent file as empty for diff
      }
      console.error(`IPC Handler: Error reading current file ${absolutePath}:`, err);
      return { success: false, message: `Failed to read current file ${filePath}: ${err.message}` };
    }
  });