const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v']);

class CancelledError extends Error {
  constructor(message = 'Обработка отменена') {
    super(message);
    this.name = 'CancelledError';
    this.code = 'CANCELLED';
  }
}

/** @type {{ cancelled: boolean, procs: Set<import('child_process').ChildProcess>, outputPath: string | null } | null} */
let activeJob = null;

function getFfmpegPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe');
  }
  return require('ffmpeg-static');
}

function getIntroPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', 'intro.mp4');
  }
  return path.join(__dirname, '..', 'assets', 'intro.mp4');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 640,
    height: 640,
    minWidth: 520,
    minHeight: 560,
    title: 'ART France Intro',
    backgroundColor: '#0b1016',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function throwIfCancelled() {
  if (activeJob?.cancelled) {
    throw new CancelledError();
  }
}

function killProcessTree(proc) {
  if (!proc || proc.killed) return;
  try {
    if (process.platform === 'win32' && proc.pid) {
      spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { windowsHide: true });
    } else {
      proc.kill('SIGTERM');
    }
  } catch {
    try {
      proc.kill('SIGKILL');
    } catch {
      // ignore
    }
  }
}

function cancelActiveJob() {
  if (!activeJob) return false;
  activeJob.cancelled = true;
  for (const proc of activeJob.procs) {
    killProcessTree(proc);
  }
  activeJob.procs.clear();
  return true;
}

function runFfmpeg(args, onStderr) {
  return new Promise((resolve, reject) => {
    throwIfCancelled();

    const ffmpegPath = getFfmpegPath();
    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
      reject(new Error('FFmpeg не найден внутри приложения.'));
      return;
    }

    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    if (activeJob) activeJob.procs.add(proc);

    let stderr = '';

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (onStderr) onStderr(text, stderr);
    });

    proc.on('error', (err) => {
      if (activeJob) activeJob.procs.delete(proc);
      reject(err);
    });

    proc.on('close', (code) => {
      if (activeJob) activeJob.procs.delete(proc);
      if (activeJob?.cancelled) {
        reject(new CancelledError());
        return;
      }
      if (code === 0) resolve();
      else {
        const tail = stderr.trim().split('\n').slice(-6).join('\n');
        reject(new Error(tail || `FFmpeg завершился с кодом ${code}`));
      }
    });
  });
}

function parseDurationSeconds(text) {
  const match = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function parseTimeSeconds(text) {
  const match = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

async function probeVideo(filePath) {
  throwIfCancelled();
  const ffmpegPath = getFfmpegPath();
  return new Promise((resolve, reject) => {
    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
      reject(new Error('FFmpeg не найден внутри приложения.'));
      return;
    }

    const proc = spawn(ffmpegPath, ['-hide_banner', '-i', filePath], { windowsHide: true });
    if (activeJob) activeJob.procs.add(proc);

    let stderr = '';
    proc.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    proc.on('error', (err) => {
      if (activeJob) activeJob.procs.delete(proc);
      reject(err);
    });
    proc.on('close', () => {
      if (activeJob) activeJob.procs.delete(proc);
      if (activeJob?.cancelled) {
        reject(new CancelledError());
        return;
      }
      const sizeMatch = stderr.match(/Video:.*?\s(\d{2,5})x(\d{2,5})/);
      const fpsMatch = stderr.match(/(\d+(?:\.\d+)?)\s*fps/);
      resolve({
        width: sizeMatch ? Number(sizeMatch[1]) : 1920,
        height: sizeMatch ? Number(sizeMatch[2]) : 1080,
        fps: fpsMatch ? Number(fpsMatch[1]) : 30,
        hasAudio: /Audio:/.test(stderr),
        duration: parseDurationSeconds(stderr),
      });
    });
  });
}

function defaultOutputPath(inputPath) {
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  return path.join(dir, `${base}_with_intro.mp4`);
}

function isVideoFile(filePath) {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function removeIfExists(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

async function normalizeClip(input, output, width, height, fps, hasAudio, onRatio) {
  throwIfCancelled();
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p`;
  let duration = null;

  const report = (_chunk, full) => {
    if (!duration) duration = parseDurationSeconds(full);
    const time = parseTimeSeconds(_chunk);
    if (duration && time != null) onRatio(Math.min(1, time / duration));
  };

  if (hasAudio) {
    await runFfmpeg(
      [
        '-y',
        '-i',
        input,
        '-vf',
        vf,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '18',
        '-c:a',
        'aac',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-b:a',
        '192k',
        output,
      ],
      report
    );
    return;
  }

  await runFfmpeg(
    [
      '-y',
      '-i',
      input,
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-vf',
      vf,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-c:a',
      'aac',
      '-shortest',
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      output,
    ],
    report
  );
}

ipcMain.handle('get-status', async () => {
  const introPath = getIntroPath();
  const ffmpegPath = getFfmpegPath();
  return {
    introReady: fs.existsSync(introPath),
    introPath,
    ffmpegReady: Boolean(ffmpegPath && fs.existsSync(ffmpegPath)),
  };
});

ipcMain.handle('pick-video', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Выберите видео',
    properties: ['openFile'],
    filters: [{ name: 'Видео', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle('open-path', async (_event, targetPath) => {
  if (targetPath && fs.existsSync(targetPath)) {
    shell.showItemInFolder(targetPath);
  }
});

ipcMain.handle('cancel-process', async () => {
  return { cancelled: cancelActiveJob() };
});

ipcMain.handle('process-video', async (event, inputPath) => {
  if (activeJob) {
    throw new Error('Уже идёт обработка. Сначала отмените её или дождитесь завершения.');
  }

  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error('Файл видео не найден.');
  }
  if (!isVideoFile(inputPath)) {
    throw new Error('Поддерживаются форматы: MP4, MOV, MKV, AVI, WEBM, M4V.');
  }

  const introPath = getIntroPath();
  if (!fs.existsSync(introPath)) {
    throw new Error('Файл интро не найден. Положите intro.mp4 в папку assets.');
  }

  const outputPath = defaultOutputPath(inputPath);
  activeJob = {
    cancelled: false,
    procs: new Set(),
    outputPath,
  };

  const send = (payload) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('process-progress', payload);
    }
  };

  const tempDir = path.join(app.getPath('temp'), `artfrance-intro-${Date.now()}`);

  try {
    send({ percent: 2, message: 'Анализ видео…' });
    const main = await probeVideo(inputPath);
    throwIfCancelled();
    const intro = await probeVideo(introPath);
    throwIfCancelled();

    const width = main.width || 1920;
    const height = main.height || 1080;
    const fps = Math.min(60, Math.max(15, Math.round(main.fps || 30)));

    fs.mkdirSync(tempDir, { recursive: true });
    const introNorm = path.join(tempDir, 'intro.mp4');
    const mainNorm = path.join(tempDir, 'main.mp4');
    const listFile = path.join(tempDir, 'list.txt');

    send({ percent: 8, message: 'Подготовка интро…' });
    await normalizeClip(introPath, introNorm, width, height, fps, intro.hasAudio, (t) => {
      send({ percent: 8 + Math.round(t * 27), message: 'Подготовка интро…' });
    });
    throwIfCancelled();

    send({ percent: 40, message: 'Обработка видео…' });
    await normalizeClip(inputPath, mainNorm, width, height, fps, main.hasAudio, (t) => {
      send({ percent: 40 + Math.round(t * 40), message: 'Обработка видео…' });
    });
    throwIfCancelled();

    const toConcatPath = (p) => p.replace(/\\/g, '/').replace(/'/g, "'\\''");
    fs.writeFileSync(
      listFile,
      `file '${toConcatPath(introNorm)}'\nfile '${toConcatPath(mainNorm)}'\n`,
      'utf8'
    );

    send({ percent: 85, message: 'Склейка…' });
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outputPath], () => {
      send({ percent: 93, message: 'Склейка…' });
    });
    throwIfCancelled();

    send({ percent: 100, message: 'Готово' });
    return { outputPath };
  } catch (err) {
    removeIfExists(outputPath);
    if (err instanceof CancelledError || err?.code === 'CANCELLED') {
      const cancelErr = new Error('Обработка отменена');
      cancelErr.code = 'CANCELLED';
      throw cancelErr;
    }
    throw err;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    activeJob = null;
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  cancelActiveJob();
  if (process.platform !== 'darwin') app.quit();
});
