// electron.js
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const { autoUpdater } = require('electron-updater');
const { execFile, spawn } = require('child_process');
const XLSX = require('xlsx');
const { randomUUID } = require('crypto');

// Configure logging for autoUpdater
autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'info';
// Disable auto download to show Release Notes first
autoUpdater.autoDownload = false; 

const fileWatchers = new Map();
const jobStateTimestamps = new Map(); // Map<filePath, Map<jobId, { status, timestamp }>>
// STATS ALGORITHM: fileJobStates tracks which jobs currently have videos ON DISK.
// Structure: Map<filePath, Set<jobId>>
const fileJobStates = new Map();

const userDataPath = app.getPath('userData');
const configPath = path.join(userDataPath, 'app-config.json');
const statsPath = path.join(userDataPath, 'stats.json'); // Path for statistics file
let mainWindow;

// --- Global Error Handler ---
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    if (mainWindow) {
        // dialog.showErrorBox('Lỗi Hệ Thống', error.stack || error.message);
        console.log("Global error suppressed to prevent interruption:", error.message);
    }
});

// --- Admin Credentials ---
const ADMIN_CREDENTIALS = {
    username: 'bescuong',
    password: '285792684'
};

// --- Helper functions ---
function readConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (!config.machineId) {
          config.machineId = randomUUID();
          writeConfig(config);
      }
      return config;
    }
  } catch (error) {
    console.error('Error reading config file:', error);
  }
  const newConfig = { machineId: randomUUID() };
  writeConfig(newConfig);
  return newConfig;
}

function writeConfig(config) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Error writing config file:', error);
  }
}

// --- Stats Helpers ---
function readStats() {
    try {
        if (fs.existsSync(statsPath)) {
            return JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
        }
    } catch (e) {
        console.error("Error reading stats:", e);
    }
    return { history: {}, promptCount: 0 }; 
}

function writeStats(stats) {
    try {
        fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
    } catch (e) {
        console.error("Error writing stats:", e);
    }
}

function incrementDailyStat() {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const stats = readStats();

    if (!stats.history) stats.history = {};
    if (!stats.history[today]) {
        stats.history[today] = { count: 0 };
    }

    stats.history[today].count += 1;
    writeStats(stats);
    return stats.history[today].count;
}

function incrementPromptCount() {
    const stats = readStats();
    if (typeof stats.promptCount !== 'number') {
        stats.promptCount = 0;
    }
    stats.promptCount += 1;
    writeStats(stats);
    return stats.promptCount;
}

// Helper to get files strictly from specific directories (Async & Non-recursive)
async function getFilesFromDirectoriesAsync(dirs) {
    let files = [];
    const mediaExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.jpg', '.jpeg', '.png', '.webp'];
    
    await Promise.all(dirs.map(async (dir) => {
        try {
            await fsPromises.access(dir); // Check if directory exists
            const dirents = await fsPromises.readdir(dir, { withFileTypes: true });
            const mediaFiles = dirents
                .filter(dirent => dirent.isFile() && mediaExtensions.includes(path.extname(dirent.name).toLowerCase()))
                .map(dirent => path.join(dir, dirent.name));
            files.push(...mediaFiles);
        } catch (e) {
            // Directory might not exist yet, ignore
        }
    }));
    return files;
}

// Core function to find videos matching jobs (Async)
async function scanVideosInternalAsync(jobs, excelFilePath) {
    const rootDir = path.dirname(excelFilePath);
    const excelNameNoExt = path.basename(excelFilePath, '.xlsx');
    const subDir = path.join(rootDir, excelNameNoExt);
    
    const targetDirs = [rootDir, subDir];
    const mediaFiles = await getFilesFromDirectoriesAsync(targetDirs);
    
    return jobs.map(job => {
        // If manually linked and exists, keep it
        if (job.videoPath && fs.existsSync(job.videoPath)) return job;
        
        // Strict ID Matching
        const jobId = job.id; 
        if (jobId) {
            const idNumber = jobId.replace(/[^0-9]/g, '');
            if (idNumber) {
               // Strict Regex: Job_1 matches Job_01 but NOT Job_10
               const regex = new RegExp(`Job_0*${idNumber}(?:[^0-9]|$)`, 'i');
               const matchedFile = mediaFiles.find(f => {
                    const fileName = path.basename(f);
                    return regex.test(fileName);
               });
               if (matchedFile) return { ...job, videoPath: matchedFile, status: 'Completed' };
            }
        }
        
        // Fallback: Name matching (if Job ID fails)
        if (job.videoName) {
             const cleanName = job.videoName.trim();
             const escapedName = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
             const nameRegex = new RegExp(`${escapedName}(?:[^0-9]|$)`, 'i');
             
             const matchedFileByName = mediaFiles.find(f => {
                 const fileName = path.basename(f, path.extname(f));
                 return nameRegex.test(fileName);
             });
             if (matchedFileByName) return { ...job, videoPath: matchedFileByName, status: 'Completed' };
        }
        return job;
    });
}

// STATS CORE LOGIC: Syncs finding with memory state (Async)
async function syncStatsAndStateAsync(filePath, jobs, explicitInit = false) {
    let isFirstTimeSeeingFile = false;

    if (!fileJobStates.has(filePath)) {
        fileJobStates.set(filePath, new Set());
        isFirstTimeSeeingFile = true;
    }

    const knownCompletedSet = fileJobStates.get(filePath);
    const updatedJobs = await scanVideosInternalAsync(jobs, filePath);

    let newCompletionCount = 0;

    updatedJobs.forEach(job => {
        const hasFile = !!job.videoPath;
        const jobId = job.id;

        if (hasFile) {
            if (!knownCompletedSet.has(jobId)) {
                knownCompletedSet.add(jobId);
                
                if (!explicitInit && !isFirstTimeSeeingFile) {
                    incrementDailyStat();
                    newCompletionCount++;
                }
            }
        } else {
            if (knownCompletedSet.has(jobId)) {
                knownCompletedSet.delete(jobId);
            }
        }
    });

    return { updatedJobs, newCompletionCount };
}

const isPackaged = app.isPackaged;
function getFfmpegPath() {
    const binary = 'ffmpeg';
    const binaryName = process.platform === 'win32' ? `${binary}.exe` : binary;
    const basePath = isPackaged
        ? path.join(process.resourcesPath, 'ffmpeg')
        : path.join(__dirname, 'resources', 'ffmpeg');
    const platformFolder = process.platform === 'win32' ? 'win' : 'mac';
    return path.join(basePath, platformFolder, binaryName);
}

function parseExcelData(data) {
    try {
        const workbook = XLSX.read(data, { type: 'buffer' });
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) return [];
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const dataAsArrays = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });
        if (!dataAsArrays || dataAsArrays.length < 2) return [];

        const headers = dataAsArrays[0].map(h => String(h).trim());
        const headerMap = {};
        headers.forEach((h, i) => { headerMap[h] = i; });
        
        const dataRows = dataAsArrays.slice(1);
        const validStatuses = ['Pending', 'Processing', 'Generating', 'Completed', 'Failed'];

        return dataRows.map((rowArray, index) => {
            const get = (headerName) => rowArray[headerMap[headerName]] || '';
            let statusStr = String(get('STATUS')).trim();
            let status = 'Pending';
            if (statusStr && validStatuses.includes(statusStr)) {
                status = statusStr;
            }

            return {
                id: get('JOB_ID') || `job_${index + 1}`,
                prompt: get('PROMPT') || '',
                imagePath: get('IMAGE_PATH') || '',
                imagePath2: get('IMAGE_PATH_2') || '',
                imagePath3: get('IMAGE_PATH_3') || '',
                status: status,
                videoName: get('VIDEO_NAME') || '',
                typeVideo: get('TYPE_VIDEO') || '',
                videoPath: get('VIDEO_PATH') || undefined,
            };
        }).filter(job => job.id && String(job.id).trim());
    } catch (e) {
        console.error("Error parsing excel:", e);
        return [];
    }
}

async function updateExcelStatus(filePath, jobIdsToUpdate, newStatus = '') {
    try {
        const fileContent = fs.readFileSync(filePath);
        const workbook = XLSX.read(fileContent, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const dataAsArrays = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        if (dataAsArrays.length < 2) return { success: true }; 

        const headers = dataAsArrays[0].map(h => String(h).trim());
        const jobIdIndex = headers.indexOf('JOB_ID');
        const statusIndex = headers.indexOf('STATUS');
        if (jobIdIndex === -1 || statusIndex === -1) {
            throw new Error('Could not find required JOB_ID or STATUS columns in the Excel file.');
        }
        
        for (let i = 1; i < dataAsArrays.length; i++) {
            if (jobIdsToUpdate.includes(dataAsArrays[i][jobIdIndex])) {
                dataAsArrays[i][statusIndex] = newStatus;
            }
        }

        const newWorksheet = XLSX.utils.aoa_to_sheet(dataAsArrays);
        if (worksheet['!cols']) newWorksheet['!cols'] = worksheet['!cols'];
        
        const newWorkbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, sheetName);
        const newFileContent = XLSX.write(newWorkbook, { bookType: 'xlsx', type: 'buffer' });
        fs.writeFileSync(filePath, newFileContent);
        
        return { success: true };
    } catch (error) {
        console.error('Error updating Excel file:', error);
        return { success: false, error: error.message };
    }
}

async function updateExcelJobFields(filePath, jobId, updates) {
    try {
        if (!fs.existsSync(filePath)) throw new Error('File not found');
        const fileContent = fs.readFileSync(filePath);
        const workbook = XLSX.read(fileContent, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const dataAsArrays = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        if (dataAsArrays.length < 2) return { success: true };

        const headers = dataAsArrays[0].map(h => String(h).trim());
        const jobIdIndex = headers.indexOf('JOB_ID');
        
        if (jobIdIndex === -1) throw new Error('JOB_ID column not found');

        const updateMap = {};
        for (const [key, val] of Object.entries(updates)) {
            let colIndex = headers.indexOf(key);
            if (colIndex === -1) {
                 colIndex = headers.length;
                 headers.push(key);
                 dataAsArrays[0][colIndex] = key;
            }
            updateMap[colIndex] = val;
        }

        let found = false;
        for (let i = 1; i < dataAsArrays.length; i++) {
            if (String(dataAsArrays[i][jobIdIndex]) === String(jobId)) {
                for (const [colIndex, val] of Object.entries(updateMap)) {
                    dataAsArrays[i][colIndex] = val;
                }
                found = true;
                break;
            }
        }

        if (!found) throw new Error(`Job ID ${jobId} not found`);

        const newWorksheet = XLSX.utils.aoa_to_sheet(dataAsArrays);
        if (worksheet['!cols']) newWorksheet['!cols'] = worksheet['!cols'];
        const newWorkbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, sheetName);
        fs.writeFileSync(filePath, XLSX.write(newWorkbook, { bookType: 'xlsx', type: 'buffer' }));
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function updateBulkJobFields(filePath, jobUpdates) {
    try {
        if (!fs.existsSync(filePath)) throw new Error('File not found');
        const fileContent = fs.readFileSync(filePath);
        const workbook = XLSX.read(fileContent, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const dataAsArrays = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        
        if (dataAsArrays.length < 2) return { success: true };

        const headers = dataAsArrays[0].map(h => String(h).trim());
        const jobIdIndex = headers.indexOf('JOB_ID');
        
        if (jobIdIndex === -1) throw new Error('JOB_ID column not found');

        const updatesMap = new Map();
        jobUpdates.forEach(item => updatesMap.set(String(item.jobId), item.updates));

        let modified = false;

        for (let i = 1; i < dataAsArrays.length; i++) {
            const currentId = String(dataAsArrays[i][jobIdIndex]);
            if (updatesMap.has(currentId)) {
                const specificUpdates = updatesMap.get(currentId);
                
                for (const [key, val] of Object.entries(specificUpdates)) {
                    let colIndex = headers.indexOf(key);
                    if (colIndex === -1) {
                         colIndex = headers.length;
                         headers.push(key);
                         dataAsArrays[0][colIndex] = key;
                    }
                    dataAsArrays[i][colIndex] = val;
                }
                modified = true;
            }
        }

        if (modified) {
            const newWorksheet = XLSX.utils.aoa_to_sheet(dataAsArrays);
            if (worksheet['!cols']) newWorksheet['!cols'] = worksheet['!cols'];
            const newWorkbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, sheetName);
            fs.writeFileSync(filePath, XLSX.write(newWorkbook, { bookType: 'xlsx', type: 'buffer' }));
        }
        
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

function showWindowAndNotify(title, message, type = 'completion') {
    if (mainWindow) {
        // Fix: Do not force window open if minimized
        if (mainWindow.isMinimized()) {
            if (Notification.isSupported()) {
                new Notification({
                    title: title,
                    body: message,
                    icon: path.join(__dirname, 'assets/icon.png')
                }).show();
            }
            // We still send the alert to render process so it appears when user eventually opens
            mainWindow.webContents.send('show-alert-modal', {
                title: title,
                message: message,
                type: type
            });
        } else {
            mainWindow.show();
            mainWindow.focus();
            mainWindow.setAlwaysOnTop(true);
            setTimeout(() => mainWindow.setAlwaysOnTop(false), 500);
            mainWindow.webContents.send('show-alert-modal', {
                title: title,
                message: message,
                type: type
            });
        }
    }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
    },
    icon: path.join(__dirname, 'assets/icon.png')
  });
  
  const startUrl = app.isPackaged 
    ? path.join(__dirname, 'dist', 'index.html') 
    : path.join(__dirname, 'index.html');

  mainWindow.loadFile(startUrl);
  
  // --- Auto Updater Events ---
  autoUpdater.on('checking-for-update', () => {
    if (mainWindow) mainWindow.webContents.send('update-status', 'checking');
  });

  autoUpdater.on('update-available', (info) => {
    if (mainWindow) mainWindow.webContents.send('update-available-prompt', info);
  });

  autoUpdater.on('update-not-available', () => {
    if (mainWindow) mainWindow.webContents.send('update-status', 'not-available');
  });

  autoUpdater.on('error', (err) => {
    if (mainWindow) mainWindow.webContents.send('update-status', 'error', err.message);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow) mainWindow.webContents.send('download-progress', progressObj.percent);
  });

  autoUpdater.on('update-downloaded', (info) => {
      if (mainWindow) mainWindow.webContents.send('update-downloaded', info);
  });
}

app.whenReady().then(() => {
  const menuTemplate = [
    { label: 'File', submenu: [{ role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Hướng dẫn sử dụng',
          click: () => {
            const guideWindow = new BrowserWindow({ width: 900, height: 700, title: 'Hướng dẫn sử dụng - Trọng Tool Auto Flow', icon: path.join(__dirname, 'assets/icon.png') });
            const guideUrl = app.isPackaged
                ? path.join(__dirname, 'dist', 'guide.html')
                : path.join(__dirname, 'guide.html');
            guideWindow.loadFile(guideUrl);
            guideWindow.setMenu(null);
          }
        },
        { type: 'separator' },
        {
            label: 'Kiểm tra cập nhật...',
            click: () => {
                autoUpdater.checkForUpdatesAndNotify();
                if(mainWindow) mainWindow.webContents.send('update-status', 'checking');
            }
        },
        {
            label: `Phiên bản ${app.getVersion()}`,
            enabled: false
        },
        { type: 'separator' },
        {
          label: 'About',
          click: () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            if (focusedWindow) {
              const currentYear = new Date().getFullYear();
              dialog.showMessageBox(focusedWindow, { 
                type: 'info', 
                title: 'Thông tin ứng dụng', 
                message: `Trọng Tool Auto Flow v${app.getVersion()}`, 
                detail: `Ứng dụng tự động hóa quy trình sản xuất Video AI.\n\nPhát triển bởi: Starbuckskohii-rgb\nCập nhật mới nhất: ${currentYear}\n\nHỗ trợ:\n- Tạo kịch bản tự động.\n- Theo dõi tiến độ ToolFlows.\n- Ghép video & Quản lý ảnh tham chiếu.` 
              });
            }
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  createWindow();
  autoUpdater.checkForUpdatesAndNotify().catch(err => console.log('Updater error:', err));

  const STUCK_JOB_TIMEOUT = 5 * 60 * 1000; 

  setInterval(() => {
    const now = Date.now();
    for (const [filePath, jobMap] of jobStateTimestamps.entries()) {
        const stuckJobIds = [];
        for (const [jobId, state] of jobMap.entries()) {
            if ((state.status === 'Processing' || state.status === 'Generating') && (now - state.timestamp > STUCK_JOB_TIMEOUT)) {
                stuckJobIds.push(jobId);
            }
        }
        if (stuckJobIds.length > 0) {
            updateExcelStatus(filePath, stuckJobIds, '')
                .then(result => {
                    // Log handled elsewhere
                });
        }
    }
  }, 60 * 1000); 
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// --- IPC Handlers ---
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('check-for-updates', async () => {
    return await autoUpdater.checkForUpdates();
});

ipcMain.handle('start-download-update', async () => {
    autoUpdater.downloadUpdate();
});

ipcMain.handle('quit-and-install', async () => {
    autoUpdater.quitAndInstall();
});

ipcMain.handle('get-app-config', () => readConfig());
ipcMain.handle('save-app-config', async (event, configToSave) => {
    try {
        writeConfig({ ...readConfig(), ...configToSave });
        return { success: true };
    } catch (error) {
        console.error('Error saving config:', error);
        return { success: false, error: error.message };
    }
});

// Admin Handlers
ipcMain.handle('verify-admin', async (event, { username, password }) => {
    if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
        return { success: true };
    }
    return { success: false, error: 'Tài khoản hoặc mật khẩu không chính xác' };
});

ipcMain.handle('delete-all-stats', async () => {
    try {
        const resetStats = { history: {}, promptCount: 0 };
        writeStats(resetStats);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('delete-stat-date', async (event, date) => {
    try {
        const stats = readStats();
        if (stats.history && stats.history[date]) {
            delete stats.history[date];
            writeStats(stats);
            return { success: true };
        }
        return { success: false, error: 'Date not found' };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('increment-prompt-count', async () => {
    try {
        incrementPromptCount();
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('get-stats', async () => {
    const stats = readStats();
    const config = readConfig();
    
    const historyArray = Object.entries(stats.history || {}).map(([date, data]) => ({
        date,
        count: data.count
    })).sort((a, b) => new Date(b.date) - new Date(a.date)); 

    const total = historyArray.reduce((sum, item) => sum + item.count, 0);
    const promptCount = stats.promptCount || 0;
    
    // Credit calculation: 1 Video = 10 Credits
    const totalCredits = total * 10;

    return {
        machineId: config.machineId || 'Unknown',
        history: historyArray,
        total,
        promptCount,
        totalCredits
    };
});

ipcMain.handle('save-file-dialog', async (event, { defaultPath, fileContent }) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { success: false, error: 'No active window' };

    const result = await dialog.showSaveDialog(win, {
        title: 'Lưu Kịch Bản Prompt',
        defaultPath: defaultPath,
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
    });

    if (result.canceled || !result.filePath) {
        return { success: false, error: 'Save dialog canceled' };
    }

    try {
        fs.writeFileSync(result.filePath, Buffer.from(fileContent));
        return { success: true, filePath: result.filePath };
    } catch (err) {
        console.error('Failed to save file:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('open-file-dialog', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { success: false, error: 'No active window' };

    const result = await dialog.showOpenDialog(win, {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
    });

    if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'User canceled' };
    }

    try {
        const files = result.filePaths.map(filePath => ({
            path: filePath,
            name: path.basename(filePath),
            content: fs.readFileSync(filePath)
        }));
        return { success: true, files };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('load-tracked-files', async () => {
    const config = readConfig();
    const paths = config.trackedFilePaths || [];
    const files = [];
    
    for (const p of paths) {
        try {
            if (fs.existsSync(p)) {
                files.push({
                    path: p,
                    name: path.basename(p),
                    content: fs.readFileSync(p)
                });
            }
        } catch (e) {
            console.error(`Failed to load tracked file: ${p}`, e);
        }
    }
    return { success: true, files };
});

ipcMain.handle('scan-folder-for-excels', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'User canceled' };
    }

    const dirPath = result.filePaths[0];
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const files = entries
            .filter(dirent => dirent.isFile() && dirent.name.toLowerCase().endsWith('.xlsx') && !dirent.name.startsWith('~$'))
            .map(dirent => {
                const fullPath = path.join(dirPath, dirent.name);
                return {
                    path: fullPath,
                    name: dirent.name,
                    content: fs.readFileSync(fullPath)
                };
            });
            
        return { success: true, files };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.on('start-watching-file', (event, filePath) => {
    if (fileWatchers.has(filePath)) return;

    if (!jobStateTimestamps.has(filePath)) {
        jobStateTimestamps.set(filePath, new Map());
    }

    // INITIALIZATION: Scan once to establish baseline (Async)
    (async () => {
        try {
            if (fs.existsSync(filePath)) {
                const buffer = fs.readFileSync(filePath);
                const jobs = parseExcelData(buffer);
                await syncStatsAndStateAsync(filePath, jobs, true); // init = true
            }
        } catch (e) {
            console.error("Error during initial watch scan:", e);
        }
    })();

    let debounceTimer;
    const watcher = fs.watch(filePath, (eventType) => {
        if (eventType === 'change') {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                // Async processing to prevent lag
                setTimeout(async () => {
                    try {
                        if (fs.existsSync(filePath)) {
                            const buffer = fs.readFileSync(filePath);
                            const rawJobs = parseExcelData(buffer);
                            
                            // REAL-TIME CHECK: Update stats based on transitions
                            const { updatedJobs } = await syncStatsAndStateAsync(filePath, rawJobs, false); // init = false

                            // Timestamp updates for stuck detection
                            const jobMap = jobStateTimestamps.get(filePath);
                            const now = Date.now();
                            updatedJobs.forEach(job => {
                                if (job.status === 'Processing' || job.status === 'Generating') {
                                    if (!jobMap.has(job.id) || jobMap.get(job.id).status !== job.status) {
                                        jobMap.set(job.id, { status: job.status, timestamp: now });
                                    }
                                } else {
                                    jobMap.delete(job.id);
                                }
                            });

                            event.sender.send('file-content-updated', { path: filePath, content: buffer });

                            // Check for completion
                            if (updatedJobs.length > 0) {
                                const allDone = updatedJobs.every(j => !!j.videoPath || j.status === 'Completed');
                                if (allDone) {
                                    showWindowAndNotify(
                                        'Hoàn tất xử lý!',
                                        `File "${path.basename(filePath)}" đã hoàn thành 100% video.`,
                                        'completion'
                                    );
                                }
                            }
                        }
                    } catch (err) {
                        console.error(`Error reading watched file ${filePath}:`, err);
                    }
                }, 0); // Execute immediately in async stack
            }, 500); 
        }
    });
    fileWatchers.set(filePath, watcher);
});

ipcMain.on('stop-watching-file', (event, filePath) => {
    if (fileWatchers.has(filePath)) {
        fileWatchers.get(filePath).close();
        fileWatchers.delete(filePath);
    }
    if (jobStateTimestamps.has(filePath)) {
        jobStateTimestamps.delete(filePath);
    }
});

ipcMain.handle('find-videos-for-jobs', async (event, { jobs, excelFilePath }) => {
    try {
        const { updatedJobs } = await syncStatsAndStateAsync(excelFilePath, jobs, false);
        return { success: true, jobs: updatedJobs };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ... Rest of the handlers (updateExcelJobFields, ffmpeg, etc.) remain mostly synchronous or efficient enough
// Keeping existing handlers as is.

ipcMain.handle('check-ffmpeg', async () => {
    const ffmpegPath = getFfmpegPath();
    return { found: fs.existsSync(ffmpegPath) };
});

ipcMain.handle('open-video-file-dialog', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { success: false, error: 'No active window' };
    const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'mkv'] }]
    });
    if (!result.canceled && result.filePaths.length > 0) {
        return { success: true, path: result.filePaths[0] };
    }
    return { success: false, error: 'Canceled' };
});

ipcMain.handle('execute-ffmpeg-combine', async (event, { jobs, targetDuration, mode, excelFileName }) => {
    const ffmpegPath = getFfmpegPath();
    if (!fs.existsSync(ffmpegPath)) return { success: false, error: 'FFmpeg executable not found.' };

    const win = BrowserWindow.getFocusedWindow();
    const saveResult = await dialog.showSaveDialog(win, {
        title: 'Lưu Video Đã Ghép',
        defaultPath: `Combined_${excelFileName.replace('.xlsx', '')}.mp4`,
        filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
    });

    if (saveResult.canceled || !saveResult.filePath) return { success: false, error: 'Save dialog canceled' };

    const outputPath = saveResult.filePath;
    const listPath = path.join(path.dirname(outputPath), `concat_list_${Date.now()}.txt`);

    try {
        const fileContent = jobs.map(j => `file '${j.videoPath.replace(/'/g, "'\\''")}'`).join('\n');
        fs.writeFileSync(listPath, fileContent);

        const args = ['-f', 'concat', '-safe', '0', '-i', listPath];
        if (mode === 'timed' && targetDuration) {
             args.push('-t', String(targetDuration));
        }
        args.push('-c', 'copy', '-y', outputPath);

        return new Promise((resolve) => {
            execFile(ffmpegPath, args, (error, stdout, stderr) => {
                try { fs.unlinkSync(listPath); } catch (e) {}
                if (error) {
                    resolve({ success: false, error: `FFmpeg failed: ${stderr}` });
                } else {
                    resolve({ success: true, filePath: outputPath });
                }
            });
        });

    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('execute-ffmpeg-combine-all', async (event, filesToProcess) => {
    const ffmpegPath = getFfmpegPath();
    if (!fs.existsSync(ffmpegPath)) return { canceled: false, successes: [], failures: ["FFmpeg not found"] };

    const win = BrowserWindow.getFocusedWindow();
    const folderResult = await dialog.showOpenDialog(win, {
        title: 'Chọn thư mục lưu các video đã ghép',
        properties: ['openDirectory']
    });

    if (folderResult.canceled || folderResult.filePaths.length === 0) return { canceled: true, successes: [], failures: [] };
    
    const outputDir = folderResult.filePaths[0];
    const successes = [];
    const failures = [];

    for (const file of filesToProcess) {
        const safeName = file.name.replace('.xlsx', '');
        const outputPath = path.join(outputDir, `Combined_${safeName}.mp4`);
        const listPath = path.join(outputDir, `concat_list_${safeName}_${Date.now()}.txt`);

        try {
            const fileContent = file.jobs.map(j => `file '${j.videoPath.replace(/'/g, "'\\''")}'`).join('\n');
            fs.writeFileSync(listPath, fileContent);
            const args = ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-y', outputPath];
            await new Promise((resolve) => {
                execFile(ffmpegPath, args, (error, stdout, stderr) => {
                    try { fs.unlinkSync(listPath); } catch (e) {}
                    if (error) {
                        failures.push(file.name);
                    } else {
                        successes.push(file.name);
                    }
                    resolve();
                });
            });
        } catch (err) {
            failures.push(file.name);
        }
    }
    return { canceled: false, successes, failures };
});

ipcMain.on('open-folder', (event, dirPath) => {
    if (dirPath && fs.existsSync(dirPath)) {
        shell.openPath(dirPath);
    }
});

ipcMain.on('open-video-path', (event, videoPath) => {
    if (videoPath && fs.existsSync(videoPath)) {
        shell.openPath(videoPath);
    }
});

ipcMain.on('show-video-in-folder', (event, videoPath) => {
    if (videoPath && fs.existsSync(videoPath)) {
        shell.showItemInFolder(videoPath);
    }
});

ipcMain.handle('delete-video-file', async (event, videoPath) => {
    const win = BrowserWindow.getFocusedWindow();
    const choice = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Hủy', 'Xóa'],
        defaultId: 1,
        title: 'Xác nhận xóa',
        message: 'Bạn có chắc chắn muốn xóa file video này không? Hành động này không thể hoàn tác.'
    });

    if (choice.response === 1) {
        try {
            if (fs.existsSync(videoPath)) {
                fs.unlinkSync(videoPath);
                return { success: true };
            } else {
                return { success: false, error: 'File not found' };
            }
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
    return { success: false, error: 'User canceled deletion.' };
});

ipcMain.handle('retry-job', async (event, { filePath, jobId }) => {
    return await updateExcelStatus(filePath, [jobId], '');
});

ipcMain.handle('retry-stuck-jobs', async (event, { filePath }) => {
    try {
        const buffer = fs.readFileSync(filePath);
        const jobs = parseExcelData(buffer);
        const stuckIds = jobs
            .filter(j => j.status === 'Processing' || j.status === 'Generating')
            .map(j => j.id);
        
        if (stuckIds.length === 0) return { success: true };
        return await updateExcelStatus(filePath, stuckIds, '');
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// Helper needed for bulk update which was missing in initial conversion? 
// Re-adding updateExcelJobFields, updateBulkJobFields, delete-job-from-excel, update-job-fields
// (Assuming they are imported or defined above. I see I pasted them above inside the XML block)

ipcMain.handle('update-job-fields', async (event, { filePath, jobId, updates }) => {
     return await updateExcelJobFields(filePath, jobId, updates);
});

ipcMain.handle('update-bulk-job-fields', async (event, { filePath, jobUpdates }) => {
    return await updateBulkJobFields(filePath, jobUpdates);
});

ipcMain.handle('delete-job-from-excel', async (event, { filePath, jobId }) => {
    try {
        if (!fs.existsSync(filePath)) throw new Error('File not found');
        const fileContent = fs.readFileSync(filePath);
        const workbook = XLSX.read(fileContent, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        let dataAsArrays = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        
        if (dataAsArrays.length < 2) return { success: false, error: 'Empty file' };

        const headers = dataAsArrays[0].map(h => String(h).trim());
        const jobIdIndex = headers.indexOf('JOB_ID');
        if (jobIdIndex === -1) throw new Error('JOB_ID column not found');

        // Filter out the row
        const newData = [dataAsArrays[0]];
        let deleted = false;
        // Re-index logic: 'Job_1', 'Job_2' sequence maintenance
        let jobCounter = 1;

        for (let i = 1; i < dataAsArrays.length; i++) {
            const row = dataAsArrays[i];
            const currentId = String(row[jobIdIndex]);
            
            if (currentId === String(jobId) && !deleted) {
                deleted = true;
                continue; // Skip this row
            }

            // Update Job ID sequence if it follows the pattern 'Job_X'
            if (String(row[jobIdIndex]).startsWith('Job_')) {
                row[jobIdIndex] = `Job_${jobCounter}`;
                jobCounter++;
            }
            newData.push(row);
        }

        if (!deleted) return { success: false, error: 'Job ID not found' };

        const newWorksheet = XLSX.utils.aoa_to_sheet(newData);
        if (worksheet['!cols']) newWorksheet['!cols'] = worksheet['!cols'];
        const newWorkbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, sheetName);
        fs.writeFileSync(filePath, XLSX.write(newWorkbook, { bookType: 'xlsx', type: 'buffer' }));
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('save-image-for-job', async (event, { excelPath, jobId, imageIndex, fileData, extension }) => {
    try {
        const dir = path.dirname(excelPath);
        const excelName = path.basename(excelPath, '.xlsx');
        // Create folder structure if not exists: [ExcelName]_Assets
        const assetDir = path.join(dir, `${excelName}_Assets`);
        if (!fs.existsSync(assetDir)) {
            fs.mkdirSync(assetDir);
        }

        const fileName = `${jobId}_img${imageIndex}${extension}`;
        const savePath = path.join(assetDir, fileName);
        
        fs.writeFileSync(savePath, Buffer.from(fileData));
        return { success: true, path: savePath };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('open-tool-flow', async () => {
    const config = readConfig();
    if (config.toolFlowPath && fs.existsSync(config.toolFlowPath)) {
        spawn(config.toolFlowPath, [], { detached: true, stdio: 'ignore' }).unref();
        return { success: true };
    }
    return { success: false, error: 'Path not configured or invalid' };
});

ipcMain.handle('set-tool-flow-path', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'Executables', extensions: ['exe'] }]
    });
    if (!result.canceled && result.filePaths.length > 0) {
        const newPath = result.filePaths[0];
        writeConfig({ ...readConfig(), toolFlowPath: newPath });
        return { success: true, path: newPath };
    }
    return { success: false, error: 'User canceled selection.' };
});

ipcMain.on('restart_app', () => {
    autoUpdater.quitAndInstall();
});