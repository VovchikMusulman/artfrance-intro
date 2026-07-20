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
    subtitle: 'Одно действие — корпоративное начало у любого ролика',
  },
  file: {
    title: 'Файл выбран',
    subtitle: 'Проверьте имя и нажмите «Добавить интро»',
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
    const result = await window.api.processVideo(selectedPath);
    lastOutputPath = result.outputPath;
    resultPath.textContent = result.outputPath;
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
