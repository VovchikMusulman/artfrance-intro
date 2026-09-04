const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { validateOptions, clipFilters } = require('./video-options');

function cancelledError() {
  return new Error('Подсчёт отменён');
}

// Each request owns its processes and temporary files, independently of export.
class SizeEstimator {
  constructor(getFfmpegPath, getIntroPath) {
    this.getFfmpegPath = getFfmpegPath;
    this.getIntroPath = getIntroPath;
    this.job = null;
  }

  cancel() {
    const job = this.job;
    if (!job) return;
    job.cancelled = true;
    for (const proc of job.procs) proc.kill();
    this.job = null;
  }

  run(job, args, probe = false, onTime = () => {}) {
    if (job.cancelled) return Promise.reject(cancelledError());
    return new Promise((resolve, reject) => {
      const proc = spawn(this.getFfmpegPath(), ['-hide_banner', '-nostdin', ...args], { windowsHide: true });
      job.procs.add(proc);
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; proc.kill(); }, 120000);
      proc.stderr.on('data', chunk => {
        const text = chunk.toString();
        stderr = (stderr + text).slice(-65536);
        const matches = [...text.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
        const match = matches.at(-1);
        if (match && !job.cancelled) onTime(+match[1] * 3600 + +match[2] * 60 + +match[3]);
      });
      proc.on('error', reject);
      proc.on('close', code => {
        clearTimeout(timer);
        job.procs.delete(proc);
        if (job.cancelled) return reject(cancelledError());
        if (timedOut) return reject(new Error('Подсчёт занял слишком много времени. Можно запустить обработку без оценки.'));
        if (code !== 0 && !probe) return reject(new Error('Не удалось обработать фрагмент для оценки размера.'));
        resolve(stderr);
      });
    });
  }

  async probe(job, file) {
    const text = await this.run(job, ['-i', file], true);
    const duration = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    const size = text.match(/Video:.*?\s(\d{2,5})x(\d{2,5})/);
    if (!duration || !size) throw new Error('Не удалось определить параметры видео для оценки.');
    const seconds = +duration[1] * 3600 + +duration[2] * 60 + +duration[3];
    if (seconds <= 0) throw new Error('Не удалось определить длительность видео.');
    return {
      duration: seconds, width: +size[1], height: +size[2],
      fps: Math.min(60, Math.max(15, Math.round(Number(text.match(/(\d+(?:\.\d+)?)\s*fps/)?.[1] || 30)))),
      hasAudio: /Audio:/.test(text),
    };
  }

  async encode(job, input, output, info, target, options, start, length, onRatio) {
    const filters = clipFilters(target.width, target.height, target.fps, options);
    // -t before -i limits source time; silence is bounded with -shortest.
    const args = ['-y', '-ss', String(start), '-t', String(length), '-i', input];
    if (!info.hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
    args.push('-map', '0:v:0', '-map', info.hasAudio ? '0:a:0' : '1:a:0',
      '-vf', filters.video, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', filters.crf, '-c:a', 'aac');
    if (info.hasAudio) args.push('-af', filters.audio, '-ar', '48000', '-ac', '2', '-b:a', '192k');
    else args.push('-shortest');
    args.push(output);
    await this.run(job, args, false, time => onRatio(Math.min(0.99, time / (length / filters.speed))));
    onRatio(1);
    return fs.statSync(output).size;
  }

  async estimate(input, rawOptions, onProgress = () => {}) {
    const options = validateOptions(rawOptions);
    this.cancel();
    const job = { cancelled: false, procs: new Set() };
    this.job = job;
    let temp;
    let lastPercent = 0;
    const report = (percent, message) => {
      if (job.cancelled) throw cancelledError();
      lastPercent = Math.max(lastPercent, Math.min(100, Math.round(percent)));
      onProgress({ percent: lastPercent, message });
    };
    try {
      report(0, 'Анализируем исходное видео…');
      const inputBytes = fs.statSync(input).size;
      const main = await this.probe(job, input);
      const introPath = this.getIntroPath();
      const intro = await this.probe(job, introPath);
      temp = fs.mkdtempSync(path.join(os.tmpdir(), 'artfrance-estimate-'));
      // Short videos are encoded in full; longer ones use three distributed samples.
      const length = main.duration <= 9 ? main.duration : 3;
      const starts = main.duration <= 9 ? [0] : [0, (main.duration - length) / 2, main.duration - length];
      const rates = [];
      for (let i = 0; i < starts.length; i++) {
        const message = `Проверяем фрагмент ${i + 1} из ${starts.length}…`;
        report(5 + i * 70 / starts.length, message);
        const bytes = await this.encode(job, input, path.join(temp, `sample-${i}.mp4`), main, main,
          options, starts[i], length, ratio => report(5 + (i + ratio) * 70 / starts.length, message));
        rates.push(bytes / (length / options.speed));
      }
      report(75, 'Учитываем фирменное интро…');
      const introBytes = await this.encode(job, introPath, path.join(temp, 'intro.mp4'), intro, main,
        { speed: 1, crf: 18 }, 0, intro.duration, ratio => report(75 + ratio * 24, 'Учитываем фирменное интро…'));
      const mean = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
      const estimateBytes = mean * (main.duration / options.speed) + introBytes;
      const spread = (Math.max(...rates) - Math.min(...rates)) / mean;
      const margin = starts.length === 1 ? 0.1 : Math.min(0.6, Math.max(0.2, spread / 2));
      report(100, 'Оценка готова');
      return { inputBytes, estimateBytes: Math.round(estimateBytes),
        lowBytes: Math.round(estimateBytes * (1 - margin)), highBytes: Math.round(estimateBytes * (1 + margin)) };
    } finally {
      if (temp) fs.rmSync(temp, { recursive: true, force: true });
      if (this.job === job) this.job = null;
    }
  }
}

module.exports = { SizeEstimator };
