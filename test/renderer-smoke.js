// Run with: node_modules/.bin/electron test/renderer-smoke.js
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const requests = [];
let cancellationCount = 0;
ipcMain.handle('get-status', () => ({ ffmpegReady: true, introReady: true }));
ipcMain.handle('cancel-estimate', () => { cancellationCount++; });
ipcMain.handle('estimate-size', (event, input, options, requestId) => new Promise((resolve, reject) => {
  requests.push({ event, input, options, requestId, resolve, reject });
}));
ipcMain.handle('process-video', () => ({ outputPath: 'D:\\Видео\\пример_with_intro.mp4', outputBytes: 25 * 1024 * 1024 }));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const result = { inputBytes: 120 * 1024 * 1024, lowBytes: 45 * 1024 * 1024, highBytes: 55 * 1024 * 1024 };

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 640, height: 840, show: false,
    webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false, offscreen: true } });
  win.setMenuBarVisibility(false);
  const js = code => win.webContents.executeJavaScript(code);
  const state = () => js(`({ status: estimateStatus.textContent, value: estimateValue.textContent,
    spinner: !estimateSpinner.hidden, progress: estimateProgress.value, retry: !estimateRetry.hidden,
    view: currentView, busy: estimateBox.getAttribute('aria-busy') })`);
  const waitForRequest = async count => {
    for (let i = 0; i < 100 && requests.length < count; i++) await pause(30);
    assert.equal(requests.length, count);
  };
  try {
    await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'));
    await js(`selectFile(${JSON.stringify('D:\\Видео\\Пример длинного названия ролика.mp4')})`);
    assert.equal((await state()).spinner, true);
    assert.equal((await state()).value, '');
    await waitForRequest(1);
    requests[0].event.sender.send('estimate-progress', { requestId: requests[0].requestId, percent: 35, message: 'Проверяем фрагмент 2 из 3…' });
    await pause(80);
    assert.match((await state()).status, /35%/);
    const outputDir = path.resolve(__dirname, '../dist/estimate-preview/ui-check');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'calculating.png'), (await win.webContents.capturePage()).toPNG());
    requests[0].resolve(result);
    await pause(80);
    assert.match((await state()).value, /45.0 МБ – 55.0 МБ/);
    assert.equal((await state()).spinner, false);
    await js(`videoCompression.value = '26'; videoCompression.dispatchEvent(new Event('input'))`);
    assert.equal((await state()).value, '');
    assert.equal((await state()).spinner, true);
    await waitForRequest(2);
    await js(`videoSpeed.value = '2'; videoSpeed.dispatchEvent(new Event('change'))`);
    requests[1].resolve(result);
    await pause(80);
    assert.equal((await state()).value, '', 'stale result must not overwrite pending state');
    requests[1].event.sender.send('estimate-progress', { requestId: requests[1].requestId, percent: 99, message: 'STALE' });
    await pause(40);
    assert.doesNotMatch((await state()).status, /STALE/);
    await waitForRequest(3);
    assert.deepEqual(requests[2].options, { speed: 2, crf: 26 });
    requests[2].reject(new Error('Тестовая ошибка'));
    await pause(80);
    assert.equal((await state()).retry, true);
    assert.equal((await state()).spinner, false);
    await js('estimateRetry.click()');
    await waitForRequest(4);
    requests[3].resolve(result);
    await pause(80);
    fs.writeFileSync(path.join(outputDir, 'ready.png'), (await win.webContents.capturePage()).toPNG());
    win.setSize(520, 560);
    await js('btnProcess.scrollIntoView({ block: "end" })');
    const layout = await js(`({ width: filePanel.clientWidth, scrollWidth: filePanel.scrollWidth,
      buttonBottom: btnProcess.getBoundingClientRect().bottom, panelBottom: filePanel.getBoundingClientRect().bottom })`);
    assert.ok(layout.scrollWidth <= layout.width + 1, JSON.stringify(layout));
    assert.ok(layout.buttonBottom <= layout.panelBottom + 1, JSON.stringify(layout));
    fs.writeFileSync(path.join(outputDir, 'small-window.png'), (await win.webContents.capturePage()).toPNG());
    await js('scheduleEstimate()');
    await waitForRequest(5);
    await js('processSelected()');
    requests[4].resolve(result);
    await pause(80);
    assert.equal((await state()).view, 'result');
    assert.match(await js('resultSize.textContent'), /25.0 МБ/);
    await js('resetToDrop()');
    assert.equal((await state()).view, 'drop');
    assert.ok(cancellationCount >= 5);
    console.log('Renderer smoke test passed; screenshots:', outputDir);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
