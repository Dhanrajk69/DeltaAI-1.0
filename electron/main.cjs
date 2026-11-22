const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 3000;
const SERVER_URL = `http://localhost:${PORT}`;

let mainWindow = null;
let serverProcess = null;

/**
 * Checks whether the local Express backend is already listening on PORT.
 */
function checkServerReady(timeoutMs = 1200) {
  return new Promise((resolve) => {
    const req = http.get(`${SERVER_URL}/api/delta/status`, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Polls the embedded Express server until it responds or maxWaitMs elapses.
 */
async function waitForServer(maxWaitMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const ready = await checkServerReady();
    if (ready) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/**
 * Starts the embedded Express backend (dist-server/server.js or server.ts) on port 3000.
 */
async function startEmbeddedServer() {
  const alreadyRunning = await checkServerReady();
  if (alreadyRunning) {
    return;
  }

  const appRoot = app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..');
  const standaloneCjsServerPath = path.join(appRoot, 'dist-server', 'server.cjs');
  const compiledServerPath = path.join(appRoot, 'dist-server', 'server.js');
  const tsServerPath = path.join(appRoot, 'server.ts');
  const tsxBinPath = path.join(
    appRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
  );

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    ELECTRON_RUN_AS_NODE: '1',
  };

  if (fs.existsSync(standaloneCjsServerPath)) {
    serverProcess = spawn(process.execPath, [standaloneCjsServerPath], {
      cwd: appRoot,
      env,
      stdio: 'pipe',
    });
  } else if (fs.existsSync(compiledServerPath)) {
    serverProcess = spawn(process.execPath, [compiledServerPath], {
      cwd: appRoot,
      env,
      stdio: 'pipe',
    });
  } else if (fs.existsSync(tsxBinPath) && fs.existsSync(tsServerPath)) {
    const childEnv = { ...env };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    serverProcess = spawn(tsxBinPath, [tsServerPath], {
      cwd: appRoot,
      env: childEnv,
      stdio: 'pipe',
    });
  } else if (fs.existsSync(tsServerPath)) {
    const childEnv = { ...env };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    serverProcess = spawn('npx', ['tsx', tsServerPath], {
      cwd: appRoot,
      env: childEnv,
      stdio: 'pipe',
    });
  }

  if (serverProcess) {
    serverProcess.stdout?.on('data', (chunk) => {
      process.stdout.write(`[DeltaAI-Server] ${chunk}`);
    });
    serverProcess.stderr?.on('data', (chunk) => {
      process.stderr.write(`[DeltaAI-Server] ${chunk}`);
    });
    serverProcess.on('exit', () => {
      serverProcess = null;
    });
  }

  await waitForServer(20000);
}

/**
 * Cleanly terminates the embedded Express server child process on shutdown.
 */
function stopEmbeddedServer() {
  if (!serverProcess) return;
  try {
    serverProcess.kill('SIGTERM');
  } catch {}
  serverProcess = null;
}

/**
 * Creates the native macOS BrowserWindow (1440x900, dark titlebar) pointed at http://localhost:3000.
 */
async function createMainWindow() {
  await startEmbeddedServer();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'DeltaAI — Institutional Crypto & Options Command Center',
    backgroundColor: '#050811',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    darkTheme: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopEmbeddedServer();
  });

  await mainWindow.loadURL(SERVER_URL);
}

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopEmbeddedServer();
  app.quit();
});

app.on('before-quit', () => {
  stopEmbeddedServer();
});

app.on('will-quit', () => {
  stopEmbeddedServer();
});
