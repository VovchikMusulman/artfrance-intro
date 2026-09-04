const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const ffmpeg = require('ffmpeg-static');
const { SPEEDS, validateOptions, clipFilters } = require('../src/video-options');

test('defaults and validation', () => {
  assert.deepEqual(validateOptions(), { speed: 1, crf: 18 });
  for (const speed of SPEEDS) assert.equal(validateOptions({ speed }).speed, speed);
  for (const options of [null, [], { speed: 3 }, { speed: '2' }, { crf: 17 }, { crf: 33 }, { crf: 20.5 }, { crf: NaN }]) {
    assert.throws(() => validateOptions(options));
  }
  assert.equal(clipFilters(320, 180, 30, { speed: 2 }).audio, 'asetpts=PTS-STARTPTS,atempo=2');
});

test('real processing: speeds, silent clips, compression, intro and cancellation', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'artfrance-options-test-'));
  const handlers = {};
  const run = (args) => {
    const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result;
  };
  const fixture = (name, sound, duration) => {
    const output = path.join(temp, name);
    run(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30',
      ...(sound ? ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000'] : []),
      '-t', String(duration), '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      ...(sound ? ['-c:a', 'aac'] : []), output]);
    return output;
  };
  try {
    const intro = fixture('intro.mp4', true, 1);
    const withAudio = fixture('audio.mp4', true, 4);
    const silent = fixture('silent.mp4', false, 4);
    const electron = {
      app: { isPackaged: false, getPath: () => temp, whenReady: () => ({ then() {} }), on() {} },
      ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
    };
    const context = vm.createContext({
      require: (name) => name === 'electron' ? electron : name.startsWith('./') ? require(`../src/${name.slice(2)}`) : require(name),
      __dirname: path.resolve(__dirname, '../src'), process,
    });
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8'), context);
    context.testIntro = intro;
    vm.runInContext('getIntroPath = () => testIntro', context);
    const progress = [];
    const event = { sender: { isDestroyed: () => false, send: (_, data) => progress.push(data.percent) } };
    const sizes = {};
    for (const input of [withAudio, silent]) {
      for (const speed of SPEEDS) {
        const { outputPath } = await handlers['process-video'](event, input, { speed, crf: 18 });
        const probe = await context.probeVideo(outputPath);
        assert.ok(Math.abs(probe.duration - (1 + 4 / speed)) < 0.3, `duration ${probe.duration}, speed ${speed}`);
        assert.equal(probe.hasAudio, true);
        run(['-i', outputPath, '-f', 'null', '-']);
        if (input === withAudio && speed === 1) sizes.normal = fs.statSync(outputPath).size;
      }
    }
    const compressed = await handlers['process-video'](event, withAudio, { speed: 1, crf: 32 });
    sizes.compressed = fs.statSync(compressed.outputPath).size;
    assert.ok(sizes.compressed < sizes.normal, JSON.stringify(sizes));
    assert.ok(progress.every(p => p >= 0 && p <= 100));
    assert.equal(progress.at(-1), 100);
    await assert.rejects(handlers['process-video'](event, withAudio, { speed: 99 }));
    const pending = handlers['process-video'](event, silent, { speed: 2 });
    await handlers['cancel-process']();
    await assert.rejects(pending, /отменена/);
    const retry = await handlers['process-video'](event, silent);
    assert.ok(fs.existsSync(retry.outputPath));
    assert.equal(retry.outputBytes, fs.statSync(retry.outputPath).size);

    const long = fixture('long.mp4', true, 12);
    const estimates = [];
    const estimateEvent = { sender: { isDestroyed: () => false, send: (_, data) => estimates.push(data) } };
    for (const input of [withAudio, silent, long]) {
      for (const options of [{ speed: 1, crf: 18 }, { speed: 2, crf: 32 }]) {
        estimates.length = 0;
        const estimate = await handlers['estimate-size'](estimateEvent, input, options, 42);
        assert.equal(estimate.inputBytes, fs.statSync(input).size);
        assert.equal(estimates[0].percent, 0);
        assert.equal(estimates.at(-1).percent, 100);
        assert.ok(estimates.every((p, i) => p.requestId === 42 && (!i || p.percent >= estimates[i - 1].percent)));
        if (input === long) assert.ok(estimates.some(p => p.message.includes('3 из 3')));
        const actual = await handlers['process-video'](event, input, options);
        assert.ok(actual.outputBytes >= estimate.lowBytes && actual.outputBytes <= estimate.highBytes,
          `actual ${actual.outputBytes}, estimate ${JSON.stringify(estimate)}`);
      }
    }
    const stoppedEstimate = handlers['estimate-size'](estimateEvent, long, {}, 43);
    const stoppedAssertion = assert.rejects(stoppedEstimate, /отменён/);
    await handlers['cancel-estimate']();
    await stoppedAssertion;
    const obsolete = handlers['estimate-size'](estimateEvent, long, {}, 44);
    const obsoleteAssertion = assert.rejects(obsolete, /отменён/);
    await handlers['estimate-size'](estimateEvent, silent, { speed: 2 }, 45);
    await obsoleteAssertion;
    const interrupted = handlers['estimate-size'](estimateEvent, long, {}, 46);
    const interruptedAssertion = assert.rejects(interrupted, /отменён/);
    await handlers['process-video'](event, silent);
    await interruptedAssertion;
    await assert.rejects(handlers['estimate-size'](estimateEvent, path.join(temp, 'missing.mp4'), {}, 47));
    await handlers['estimate-size'](estimateEvent, silent, {}, 48);
    const cancelDuringEncode = { sender: { isDestroyed: () => false, send: (_, data) => {
      if (data.percent > 5 && data.percent < 75) handlers['cancel-estimate']();
    } } };
    await assert.rejects(handlers['estimate-size'](cancelDuringEncode, long, {}, 49), /отменён/);
    await handlers['estimate-size'](estimateEvent, silent, {}, 50);
    console.log('Output bytes (CRF 18 vs 32):', sizes);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
