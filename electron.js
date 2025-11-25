// electron.js
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { randomUUID } = require('crypto');
const XLSX = require('xlsx'); // Đảm bảo bạn đã cài: npm install xlsx

// --- CẤU HÌNH LOG UPDATE ---
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

// --- CẤU HÌNH DỮ LIỆU NGƯỜI DÙNG ---
const userDataPath = app.getPath('userData');
const configPath = path.join(userDataPath, 'app-config.json');

// --- HÀM ĐỌC/GHI CONFIG (QUAN TRỌNG ĐỂ APP KHỞI ĐỘNG) ---
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

// --- KHỞI TẠO CỬA SỔ ---
function createWindow() {
  const mainWindow = new BrowserWindow({
    title: "Trọng - Tool Kịch Bản VEO3",
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: false, // Cần thiết cho code cũ của bạn chạy được
      nodeIntegration: true,
      webSecurity: false
    },
    icon: path.join(__dirname, 'public/icon.ico') 
  });

  // Logic load file (Sửa lỗi màn hình trắng)
  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  // Kích hoạt kiểm tra update
  mainWindow.once('ready-to-show', () => {
    if (!isDev) autoUpdater.checkForUpdatesAndNotify();
  });
}

// --- APP READY ---
app.whenReady().then(() => {
  createWindow();

  // --- CÁC HÀM XỬ LÝ (IPC HANDLERS) TỪ FILE MAIN.JS CŨ ---
  
  // 1. Hàm lấy config (App.tsx chờ hàm này để tắt Loading)
  ipcMain.handle('get-app-config', () => readConfig());

  // 2. Hàm lưu config (Lưu key, trạng thái)
  ipcMain.handle('save-app-config', async (event, configToSave) => {
    try {
        writeConfig({ ...readConfig(), ...configToSave });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
  });

  // 3. Hàm lưu file Excel
  ipcMain.handle('save-file-dialog', async (event, { defaultPath, fileContent }) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { success: false, error: 'No window' };

    const result = await dialog.showSaveDialog(win, {
        title: 'Lưu Kịch Bản Prompt',
        defaultPath: defaultPath,
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
    });

    if (result.canceled || !result.filePath) {
        return { success: false, error: 'Cancelled' };
    }

    try {
        fs.writeFileSync(result.filePath, Buffer.from(fileContent));
        return { success: true, filePath: result.filePath };
    } catch (err) {
        return { success: false, error: err.message };
    }
  });

  // 4. Hàm lấy version
  ipcMain.handle('get-app-version', () => app.getVersion());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});