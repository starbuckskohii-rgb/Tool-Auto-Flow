

// electron.js
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { randomUUID } = require('crypto');
const XLSX = require('xlsx'); 
const { execFile, spawn } = require('child_process');

// --- CẤU HÌNH LOG UPDATE ---
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
// Tắt tự động download để người dùng chọn
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

// --- BIẾN TOÀN CỤC (WATCHER & STATS) ---
const fileWatchers = new Map();
const jobStateTimestamps = new Map();
const fileJobStates = new Map();
let mainWindow;

// --- CẤU HÌNH DỮ LIỆU NGƯỜI DÙNG ---
const userDataPath = app.getPath('userData');
const configPath = path.join(userDataPath, 'app-config.json');
const statsPath = path.join(userDataPath, 'stats.json');

// --- Global Error Handler (Modified to ignore Updater SemVer errors) ---
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    
    // Nếu lỗi do phiên bản không hợp lệ (SemVer), chỉ log và bỏ qua, không hiện popup
    if (error.message && error.message.includes('valid semver')) {
        return;
    }

    if (mainWindow) {
        dialog.showErrorBox('Lỗi Hệ Thống', error.stack || error.message);
    }
});

// --- HÀM XỬ LÝ CONFIG ---
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
    console.error('Error reading config:', error);
  }
  const newConfig = { machineId: randomUUID() };
  writeConfig(newConfig);
  return newConfig;
}

function writeConfig(config) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Error writing config:', error);
  }
}

// --- HÀM XỬ LÝ STATS ---
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
    const today = new Date().toISOString().split('T')[0];
    const stats = readStats();
    if (!stats.history) stats.history = {};
    if (!stats.history[today]) stats.history[today] = { count: 0 };
    stats.history[today].count += 1;
    writeStats(stats);
    return stats.history[today].count;
}

function incrementPromptCount() {
    const stats = readStats();
    if (typeof stats.promptCount !== 'number') stats.promptCount = 0;
    stats.promptCount += 1;
    writeStats(stats);
    return stats.promptCount;
}

// --- HÀM HỖ TRỢ FILE & VIDEO ---
function getFilesFromDirectories(dirs) {
    let files = [];
    const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
    dirs.forEach(dir => {
        try {
            if (fs.existsSync(dir)) {
                const dirents = fs.readdirSync(dir, { withFileTypes: true });
                const videoFiles = dirents
                    .filter(dirent => dirent.isFile() && videoExtensions.includes(path.extname(dirent.name).toLowerCase()))
                    .map(dirent => path.join(dir, dirent.name));
                files = [...files, ...videoFiles];
            }
        } catch (e) {}
    });
    return files;
}

function scanVideosInternal(jobs, excelFilePath) {
    const rootDir = path.dirname(excelFilePath);
    const excelNameNoExt = path.basename(excelFilePath, '.xlsx');
    const subDir = path.join(rootDir, excelNameNoExt);
    const targetDirs = [rootDir, subDir];
    const videoFiles = getFilesFromDirectories(targetDirs);
    
    return jobs.map(job => {
        if (job.videoPath && fs.existsSync(job.videoPath)) return job;
        
        const jobId = job.id; 
        if (jobId) {
            const idNumber = jobId.replace(/[^0-9]/g, '');
            if (idNumber) {
               const regex = new RegExp(`Job_0*${idNumber}(?:[^0-9]|$)`, 'i');
               const matchedFile = videoFiles.find(f => regex.test(path.basename(f)));
               if (matchedFile) return { ...job, videoPath: matchedFile, status: 'Completed' };
            }
        }
        
        if (job.videoName) {
             const cleanName = job.videoName.trim();
             const escapedName = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
             const nameRegex = new RegExp(`${escapedName}(?:[^0-9]|$)`, 'i');
             const matchedFileByName = videoFiles.find(f => nameRegex.test(path.basename(f, path.extname(f))));
             if (matchedFileByName) return { ...job, videoPath: matchedFileByName, status: 'Completed' };
        }
        return job;
    });
}

function syncStatsAndState(filePath, jobs, explicitInit = false) {
    let isFirstTimeSeeingFile = false;
    if (!fileJobStates.has(filePath)) {
        fileJobStates.set(filePath, new Set());
        isFirstTimeSeeingFile = true;
    }
    const knownCompletedSet = fileJobStates.get(filePath);
    const updatedJobs = scanVideosInternal(jobs, filePath);
    let newCompletionCount = 0;

    updatedJobs.forEach(job => {
        const hasVideo = !!job.videoPath;
        const jobId = job.id;
        if (hasVideo) {
            if (!knownCompletedSet.has(jobId)) {
                knownCompletedSet.add(jobId);
                if (!explicitInit && !isFirstTimeSeeingFile) {
                    incrementDailyStat();
                    newCompletionCount++;
                }
            }
        } else {
            if (knownCompletedSet.has(jobId)) knownCompletedSet.delete(jobId);
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
            if (statusStr && validStatuses.includes(statusStr)) status = statusStr;

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
        if (jobIdIndex === -1 || statusIndex === -1) throw new Error('Columns not found');
        
        for (let i = 1; i < dataAsArrays.length; i++) {
            if (jobIdsToUpdate.includes(dataAsArrays[i][jobIdIndex])) {
                dataAsArrays[i][statusIndex] = newStatus;
            }
        }
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
                 // Create column if missing
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

function showWindowAndNotify(title, message, type = 'completion') {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(true);
        setTimeout(() => mainWindow.setAlwaysOnTop(false), 500);
        mainWindow.webContents.send('show-alert-modal', { title, message, type });
    }
}

// --- KHỞI TẠO APP ---
function createWindow() {
  mainWindow = new BrowserWindow({
    title: "Trọng - Tool Auto Flow",
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: false, 
      nodeIntegration: true,
      webSecurity: false
    },
    icon: path.join(__dirname, 'public/icon.ico') 
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  // Updater Events
  autoUpdater.on('checking-for-update', () => mainWindow?.webContents.send('update-status', 'checking'));
  
  // Khi có bản cập nhật, không tự tải mà gửi thông tin cho người dùng chọn
  autoUpdater.on('update-available', (info) => {
      mainWindow?.webContents.send('update-available-prompt', info);
      mainWindow?.webContents.send('update-status', 'available');
  });

  autoUpdater.on('update-not-available', () => mainWindow?.webContents.send('update-status', 'not-available'));
  
  autoUpdater.on('error', (err) => {
      console.warn("Update error:", err.message);
      if (!err.message.includes('valid semver')) {
        mainWindow?.webContents.send('update-status', 'error', err.message);
      }
  });
  
  autoUpdater.on('download-progress', (progressObj) => {
    mainWindow?.webContents.send('download-progress', progressObj.percent);
  });

  autoUpdater.on('update-downloaded', () => {
      mainWindow?.webContents.send('update-downloaded');
      mainWindow?.webContents.send('update-status', 'downloaded');
  });

  if (!isDev) {
      try {
        autoUpdater.checkForUpdates();
      } catch (e) {
        console.error("Failed to check for updates:", e);
      }
  }
}

app.whenReady().then(() => {
  // --- MENU ---
  const menuTemplate = [
    { label: 'File', submenu: [{ role: 'quit' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }] },
    { label: 'Help', submenu: [
        { 
            label: 'Kiểm tra cập nhật...', 
            click: () => { 
                try {
                    autoUpdater.checkForUpdates(); 
                    mainWindow?.webContents.send('update-status', 'checking'); 
                } catch(e) {
                    console.error("Manual update check failed", e);
                }
            }
        },
        { label: `Phiên bản ${app.getVersion()}`, enabled: false }
    ]}
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  
  createWindow();

  // --- STUCK JOBS MONITOR ---
  setInterval(() => {
    const now = Date.now();
    for (const [filePath, jobMap] of jobStateTimestamps.entries()) {
        const stuckJobIds = [];
        for (const [jobId, state] of jobMap.entries()) {
            if ((state.status === 'Processing' || state.status === 'Generating') && (now - state.timestamp > 300000)) { // 5 mins
                stuckJobIds.push(jobId);
            }
        }
        if (stuckJobIds.length > 0) updateExcelStatus(filePath, stuckJobIds, '');
    }
  }, 60000);
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// --- IPC HANDLERS ---

ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('check-for-updates', () => {
    try {
        autoUpdater.checkForUpdates();
    } catch (e) {
        console.error("IPC update check failed", e);
    }
});
ipcMain.handle('start-download-update', () => {
    try {
        autoUpdater.downloadUpdate();
    } catch(e) {
        console.error("Download failed", e);
    }
});
ipcMain.handle('quit-and-install', () => autoUpdater.quitAndInstall());

ipcMain.handle('get-app-config', () => readConfig());
ipcMain.handle('save-app-config', async (event, configToSave) => {
    try { writeConfig({ ...readConfig(), ...configToSave }); return { success: true }; } 
    catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('scan-folder-for-excels', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) return { success: false, error: 'Canceled' };

    const dirPath = result.filePaths[0];
    try {
        const entries = fs.readdirSync(dirPath);
        const files = entries
            .filter(entry => entry.endsWith('.xlsx') && !entry.startsWith('~$'))
            .map(entry => {
                const fullPath = path.join(dirPath, entry);
                return {
                    path: fullPath,
                    name: entry,
                    content: fs.readFileSync(fullPath)
                };
            });
        return { success: true, files };
    } catch (e) {
        return { success: false, error: e.message };
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
            console.error(`Failed to load tracked file ${p}`, e);
        }
    }
    return { success: true, files };
});

ipcMain.handle('save-file-dialog', async (event, { defaultPath, fileContent }) => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win, {
        title: 'Lưu Kịch Bản', defaultPath, filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' };
    try { fs.writeFileSync(result.filePath, Buffer.from(fileContent)); return { success: true, filePath: result.filePath }; } 
    catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('open-file-dialog', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (result.canceled || result.filePaths.length === 0) return { success: false, error: 'Canceled' };
    try {
        const files = result.filePaths.map(p => ({ path: p, name: path.basename(p), content: fs.readFileSync(p) }));
        return { success: true, files };
    } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.on('start-watching-file', (event, filePath) => {
    if (fileWatchers.has(filePath)) return;
    if (!jobStateTimestamps.has(filePath)) jobStateTimestamps.set(filePath, new Map());

    try {
        if (fs.existsSync(filePath)) {
            const buffer = fs.readFileSync(filePath);
            syncStatsAndState(filePath, parseExcelData(buffer), true);
        }
    } catch (e) {}

    let debounceTimer;
    const watcher = fs.watch(filePath, (eventType) => {
        if (eventType === 'change') {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                setTimeout(() => {
                    try {
                        if (fs.existsSync(filePath)) {
                            const buffer = fs.readFileSync(filePath);
                            const { updatedJobs } = syncStatsAndState(filePath, parseExcelData(buffer), false);
                            
                            const jobMap = jobStateTimestamps.get(filePath);
                            const now = Date.now();
                            updatedJobs.forEach(job => {
                                if (job.status === 'Processing' || job.status === 'Generating') {
                                    if (!jobMap.has(job.id) || jobMap.get(job.id).status !== job.status) jobMap.set(job.id, { status: job.status, timestamp: now });
                                } else jobMap.delete(job.id);
                            });

                            event.sender.send('file-content-updated', { path: filePath, content: buffer });
                        }
                    } catch (e) {}
                }, 500);
            }, 100); 
        }
    });
    fileWatchers.set(filePath, watcher);
});

ipcMain.on('stop-watching-file', (event, filePath) => {
    if (fileWatchers.has(filePath)) { fileWatchers.get(filePath).close(); fileWatchers.delete(filePath); }
    if (jobStateTimestamps.has(filePath)) jobStateTimestamps.delete(filePath);
});

ipcMain.handle('find-videos-for-jobs', async (event, { jobs, excelFilePath }) => {
    try {
        const { updatedJobs } = syncStatsAndState(excelFilePath, jobs, false);
        return { success: true, jobs: updatedJobs };
    } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('open-tool-flow', async () => {
    const config = readConfig();
    if (config.toolFlowPath && fs.existsSync(config.toolFlowPath)) {
        spawn(config.toolFlowPath, [], { detached: true, stdio: 'ignore', cwd: path.dirname(config.toolFlowPath) }).unref();
        return { success: true };
    }
    return { success: false, error: 'Path not configured' };
});

ipcMain.handle('set-tool-flow-path', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Executables', extensions: ['exe'] }] });
    if (!result.canceled && result.filePaths.length > 0) {
        writeConfig({ ...readConfig(), toolFlowPath: result.filePaths[0] });
        return { success: true, path: result.filePaths[0] };
    }
    return { success: false };
});

ipcMain.handle('retry-job', async (event, { filePath, jobId }) => {
    return await updateExcelStatus(filePath, [jobId], '');
});

ipcMain.handle('retry-stuck-jobs', async (event, { filePath }) => {
    try {
        const buffer = fs.readFileSync(filePath);
        const stuckIds = parseExcelData(buffer).filter(j => j.status === 'Processing' || j.status === 'Generating').map(j => j.id);
        if (stuckIds.length > 0) await updateExcelStatus(filePath, stuckIds, '');
        return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('update-job-fields', async (event, { filePath, jobId, updates }) => {
    return await updateExcelJobFields(filePath, jobId, updates);
});

ipcMain.handle('save-image-for-job', async (event, { excelPath, jobId, imageIndex, fileData, extension }) => {
    try {
        const dir = path.dirname(excelPath);
        const excelName = path.basename(excelPath, '.xlsx');
        const assetsDir = path.join(dir, `${excelName}_assets`);
        
        if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir);
        
        const fileName = `${jobId}_Ref_${imageIndex}${extension}`;
        const filePath = path.join(assetsDir, fileName);
        
        fs.writeFileSync(filePath, Buffer.from(fileData));
        return { success: true, path: filePath };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('execute-ffmpeg-combine', async (event, { jobs, targetDuration, mode, excelFileName }) => {
    const ffmpegPath = getFfmpegPath();
    if (!fs.existsSync(ffmpegPath)) return { success: false, error: 'FFmpeg not found' };
    const win = BrowserWindow.getFocusedWindow();
    const saveResult = await dialog.showSaveDialog(win, { defaultPath: `Combined_${excelFileName.replace('.xlsx', '')}.mp4`, filters: [{ name: 'MP4', extensions: ['mp4'] }] });
    if (saveResult.canceled) return { success: false, error: 'Canceled' };

    const listPath = path.join(path.dirname(saveResult.filePath), `concat_${Date.now()}.txt`);
    try {
        fs.writeFileSync(listPath, jobs.map(j => `file '${j.videoPath.replace(/'/g, "'\\''")}'`).join('\n'));
        const args = ['-f', 'concat', '-safe', '0', '-i', listPath];
        if (mode === 'timed' && targetDuration) args.push('-t', String(targetDuration));
        args.push('-c', 'copy', '-y', saveResult.filePath);
        
        return new Promise(resolve => execFile(ffmpegPath, args, (err, stdout, stderr) => {
            try { fs.unlinkSync(listPath); } catch (e) {}
            resolve(err ? { success: false, error: stderr } : { success: true, filePath: saveResult.filePath });
        }));
    } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('execute-ffmpeg-combine-all', async (event, filesToProcess) => {
    const ffmpegPath = getFfmpegPath();
    if (!fs.existsSync(ffmpegPath)) return { canceled: false, successes: [], failures: ["FFmpeg not found"] };
    
    const win = BrowserWindow.getFocusedWindow();
    const folderResult = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (folderResult.canceled) return { canceled: true };
    
    const outputDir = folderResult.filePaths[0];
    const successes = [], failures = [];

    for (const file of filesToProcess) {
        const outputPath = path.join(outputDir, `Combined_${file.name.replace('.xlsx', '')}.mp4`);
        const listPath = path.join(outputDir, `concat_${Date.now()}.txt`);
        try {
            fs.writeFileSync(listPath, file.jobs.map(j => `file '${j.videoPath.replace(/'/g, "'\\''")}'`).join('\n'));
            await new Promise(resolve => execFile(ffmpegPath, ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-y', outputPath], (err) => {
                fs.unlinkSync(listPath);
                err ? failures.push(file.name) : successes.push(file.name);
                resolve();
            }));
        } catch (e) { failures.push(file.name); }
    }
    return { canceled: false, successes, failures };
});

ipcMain.handle('delete-video-file', async (event, videoPath) => {
    if (fs.existsSync(videoPath)) { fs.unlinkSync(videoPath); return { success: true }; }
    return { success: false, error: 'Not found' };
});
ipcMain.on('open-video-path', (e, p) => fs.existsSync(p) && shell.openPath(p));
ipcMain.on('show-video-in-folder', (e, p) => fs.existsSync(p) && shell.showItemInFolder(p));
ipcMain.handle('check-ffmpeg', () => ({ found: fs.existsSync(getFfmpegPath()) }));
ipcMain.handle('get-stats', async () => {
    const stats = readStats();
    const config = readConfig();
    const historyArray = Object.entries(stats.history || {}).map(([date, d]) => ({ date, count: d.count })).sort((a,b)=>new Date(b.date)-new Date(a.date));
    return { machineId: config.machineId, history: historyArray, total: historyArray.reduce((s,i)=>s+i.count,0), promptCount: stats.promptCount||0, totalCredits: (historyArray.reduce((s,i)=>s+i.count,0))*10 };
});
ipcMain.handle('increment-prompt-count', () => { incrementPromptCount(); return {success:true}; });
