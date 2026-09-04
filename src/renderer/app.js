const dropzone = document.getElementById('dropzone');
const filePanel = document.getElementById('file-panel');
const progressPanel = document.getElementById('progress-panel');
const resultPanel = document.getElementById('result-panel');
const fileNameEl = document.getElementById('file-name');
const filePathEl = document.getElementById('file-path');
const fileExtEl = document.getElementById('file-ext');
const errorLine = document.getElementById('error-line');
const progressBar = document.getElementById('progress-bar');
const progressBarWrap = document.getElementById('progress-bar-wrap');
const progressMessage = document.getElementById('progress-message');
const progressPercent = document.getElementById('progress-percent');
const resultPath = document.getElementById('result-path');
const headline = document.getElementById('headline');
const subtitle = document.getElementById('subtitle');
const toastEl = document.getElementById('toast');
const pillFfmpeg = document.getElementById('pill-ffmpeg');
const pillIntro = document.getElementById('pill-intro');
const videoSpeed = document.getElementById('video-speed');
const videoCompression = document.getElementById('video-compression');
const compressionLabel = document.getElementById('compression-label');
const estimateBox = document.getElementById('size-estimate');
const estimateStatus = document.getElementById('estimate-status');
const estimateValue = document.getElementById('estimate-value');
const estimateSpinner = document.getElementById('estimate-spinner');
const estimateProgress = document.getElementById('estimate-progress');
const estimateRetry = document.getElementById('btn-estimate-retry');
const resultSize = document.getElementById('result-size');

function updateCompressionLabel() {
  const crf = Number(videoCompression.value);
  const level = crf === 18 ? 'Слабое · текущее качество' : crf <= 22 ? 'Слабое' : crf <= 27 ? 'Среднее' : 'Сильное · ниже качество';
  compressionLabel.textContent = level;
  videoCompression.setAttribute('aria-valuetext', level);
}
videoCompression.addEventListener('input', updateCompressionLabel);
updateCompressionLabel();

const btnProcess = document.getElementById('btn-process');
const btnClear = document.getElementById('btn-clear');
const btnOpen = document.getElementById('btn-open');
const btnAgain = document.getElementById('btn-again');
const btnCancel = document.getElementById('btn-cancel');
const btnBrowse = document.getElementById('btn-browse');

const panels = {
  drop: dropzone,
  file: filePanel,
  progress: progressPanel,
  result: resultPanel,
};

const copyByView = {
  drop: {
    title: 'Добавить интро',
    subtitle: 'Одно действие — фирменное начало у любого ролика',
  },
  file: {
    title: 'Файл выбран',
    subtitle: 'Выберите скорость и сжатие, затем добавьте интро',
  },
  progress: {
    title: 'Идёт склейка',
    subtitle: 'Интро ставится в начало вашего видео',
  },
  result: {
    title: 'Готово',
    subtitle: 'Можно открыть папку или обработать следующий ролик',
  },
};

let selectedPath = null;
let lastOutputPath = null;
let busy = false;
let cancelling = false;
let currentView = 'drop';
let toastTimer = null;
let dragDepth = 0;
let estimateTimer = null;
let estimateRequestId = 0;

function formatBytes(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} ГБ` : `${mb.toFixed(1)} МБ`;
}

function stopEstimate() {
  clearTimeout(estimateTimer);
  estimateRequestId += 1;
  window.api.cancelEstimate().catch(() => {});
}

function setEstimating(on) {
  estimateBox.setAttribute('aria-busy', String(on));
  estimateSpinner.hidden = !on;
  estimateProgress.hidden = !on;
}

function scheduleEstimate() {
  stopEstimate();
  if (!selectedPath || busy) return;
  const requestId = estimateRequestId;
  const inputPath = selectedPath;
  const options = { speed: Number(videoSpeed.value), crf: Number(videoCompression.value) };
  setEstimating(true);
  estimateRetry.hidden = true;
  estimateValue.textContent = '';
  estimateProgress.value = 0;
  estimateStatus.textContent = 'Подсчитываем размер… Подготовка';
  // Debounce slider movements without leaving an old estimate visible.
  estimateTimer = setTimeout(async () => {
    try {
      const result = await window.api.estimateSize(inputPath, options, requestId);
      if (requestId !== estimateRequestId || busy) return;
      estimateStatus.textContent = 'Оценка готова';
      estimateValue.textContent = `Исходный: ${formatBytes(result.inputBytes)} → С интро: ≈ ${formatBytes(result.lowBytes)} – ${formatBytes(result.highBytes)}`;
    } catch (err) {
      if (requestId !== estimateRequestId || busy) return;
      estimateStatus.textContent = 'Не удалось оценить размер';
      estimateValue.textContent = err?.message || 'Можно продолжить без оценки.';
      estimateRetry.hidden = false;
    } finally {
      if (requestId === estimateRequestId) setEstimating(false);
    }
  }, 450);
}

window.api.onEstimateProgress(data => {
  if (data.requestId !== estimateRequestId || busy) return;
  const percent = Math.max(0, Math.min(100, Math.round(data.percent || 0)));
  estimateProgress.value = percent;
  estimateStatus.textContent = `Подсчитываем размер… ${percent}% · ${data.message}`;
});
videoSpeed.addEventListener('change', scheduleEstimate);
videoCompression.addEventListener('input', scheduleEstimate);
estimateRetry.addEventListener('click', scheduleEstimate);

function basename(filePath) {
  return String(filePath || '').split(/[/\\]/).pop() || filePath;
}

function dirname(filePath) {
  const parts = String(filePath || '').split(/[/\\]/);
  parts.pop();
  return parts.join('\\') || filePath;
}

function extension(filePath) {
  const name = basename(filePath);
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toUpperCase() : 'VIDEO';
}

function showError(message) {
  if (!message) {
    errorLine.hidden = true;
    errorLine.textContent = '';
    return;
  }
  errorLine.hidden = false;
  errorLine.textContent = message;
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  requestAnimationFrame(() => toastEl.classList.add('is-visible'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('is-visible');
    setTimeout(() => {
      toastEl.hidden = true;
    }, 250);
  }, 2200);
}

function setSteps(active) {
  const order = ['drop', 'file', 'progress', 'result'];
  const activeIndex = order.indexOf(active);
  document.querySelectorAll('.step').forEach((el) => {
    const key = el.dataset.step;
    const index = order.indexOf(key);
    el.classList.toggle('is-active', key === active);
    el.classList.toggle('is-done', index < activeIndex);
  });
}

function setView(view) {
  currentView = view;
  Object.entries(panels).forEach(([key, el]) => {
    const on = key === view;
    el.classList.toggle('is-visible', on);
    el.hidden = !on;
  });
  setSteps(view);
  const copy = copyByView[view];
  if (copy) {
    headline.textContent = copy.title;
    subtitle.textContent = copy.subtitle;
  }
  if (view === 'file') {
    requestAnimationFrame(() => btnProcess.focus());
  } else if (view === 'result') {
    requestAnimationFrame(() => btnOpen.focus());
  } else if (view === 'drop') {
    requestAnimationFrame(() => dropzone.focus());
  }
}

function selectFile(filePath) {
  if (!filePath || busy) return;
  selectedPath = filePath;
  fileNameEl.textContent = basename(filePath);
  filePathEl.textContent = dirname(filePath);
  fileExtEl.textContent = extension(filePath);
  showError('');
  setView('file');
  scheduleEstimate();
}

function setPill(el, ok, okText, badText) {
  el.dataset.state = ok ? 'ok' : 'bad';
  el.textContent = ok ? okText : badText;
}

async function refreshStatus() {
  try {
    const status = await window.api.getStatus();
    setPill(pillFfmpeg, status.ffmpegReady, 'Движок готов', 'Нет движка');
    setPill(pillIntro, status.introReady, 'Интро готово', 'Нет интро');
    if (!status.introReady) {
      showError('Положите корпоративный intro.mp4 в папку assets и перезапустите программу.');
    }
  } catch {
    setPill(pillFfmpeg, false, 'Движок готов', 'Ошибка статуса');
    setPill(pillIntro, false, 'Интро готово', 'Ошибка статуса');
  }
}

function isCancelledError(err) {
  return err?.code === 'CANCELLED' || /отменена/i.test(err?.message || '');
}

async function processSelected() {
  if (!selectedPath || busy) return;
  stopEstimate();
  busy = true;
  cancelling = false;
  btnProcess.disabled = true;
  btnCancel.disabled = false;
  btnCancel.textContent = 'Отменить';
  showError('');
  setView('progress');
  progressBar.style.width = '0%';
  progressPercent.textContent = '0%';
  progressBarWrap.setAttribute('aria-valuenow', '0');
  progressMessage.textContent = 'Запуск…';

  const stop = window.api.onProgress((data) => {
    if (cancelling) return;
    const percent = Math.max(0, Math.min(100, Math.round(data.percent || 0)));
    progressBar.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;
    progressBarWrap.setAttribute('aria-valuenow', String(percent));
    if (data.message) progressMessage.textContent = data.message;
  });

  try {
    const result = await window.api.processVideo(selectedPath, {
      speed: Number(videoSpeed.value),
      crf: Number(videoCompression.value),
    });
    lastOutputPath = result.outputPath;
    resultPath.textContent = result.outputPath;
    resultSize.textContent = `Фактический размер: ${formatBytes(result.outputBytes)}`;
    setView('result');
    showToast('Интро успешно добавлено');
  } catch (err) {
    if (isCancelledError(err)) {
      showError('');
      setView('file');
      showToast('Обработка отменена');
    } else {
      showError(err?.message || String(err));
      setView('file');
    }
  } finally {
    stop();
    busy = false;
    cancelling = false;
    btnProcess.disabled = false;
    btnCancel.disabled = false;
    btnCancel.textContent = 'Отменить';
    if (currentView === 'file') scheduleEstimate();
  }
}

async function cancelSelected() {
  if (!busy || cancelling) return;
  cancelling = true;
  btnCancel.disabled = true;
  btnCancel.textContent = 'Отмена…';
  progressMessage.textContent = 'Отмена…';
  try {
    await window.api.cancelProcess();
  } catch {
    // process-video promise settles with CANCELLED
  }
}

function resetToDrop() {
  stopEstimate();
  selectedPath = null;
  lastOutputPath = null;
  showError('');
  setView('drop');
  refreshStatus();
}

async function browse() {
  if (busy) return;
  const filePath = await window.api.pickVideo();
  selectFile(filePath);
}

dropzone.addEventListener('click', (e) => {
  if (e.target === btnBrowse) return;
  browse();
});

btnBrowse.addEventListener('click', (e) => {
  e.stopPropagation();
  browse();
});

dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    browse();
  }
});

dropzone.addEventListener('dragenter', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dragDepth += 1;
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
});

dropzone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dragDepth = 0;
  dropzone.classList.remove('dragover');
  const file = e.dataTransfer?.files?.[0];
  const filePath = file ? window.api.pathForFile(file) : null;
  if (!filePath) {
    showError('Не удалось прочитать файл. Выберите его кнопкой «Выбрать файл».');
    return;
  }
  selectFile(filePath);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && busy) {
    e.preventDefault();
    cancelSelected();
    return;
  }
  if (e.key === 'Enter' && currentView === 'file' && !busy && !e.repeat) {
    const tag = document.activeElement?.tagName;
    if (tag === 'SELECT' || tag === 'INPUT') return;
    if (tag === 'BUTTON' && document.activeElement !== btnProcess) return;
    e.preventDefault();
    processSelected();
  }
});

btnProcess.addEventListener('click', processSelected);
btnCancel.addEventListener('click', cancelSelected);
btnClear.addEventListener('click', resetToDrop);
btnAgain.addEventListener('click', resetToDrop);
btnOpen.addEventListener('click', () => {
  if (lastOutputPath) window.api.openPath(lastOutputPath);
});

setView('drop');
refreshStatus();
