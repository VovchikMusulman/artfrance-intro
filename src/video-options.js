const SPEEDS = [1, 1.25, 1.5, 1.75, 2];

function validateOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Некорректные настройки видео.');
  }
  const { speed = 1, crf = 18 } = options;
  if (!SPEEDS.includes(speed)) throw new Error('Выберите скорость от 1× до 2×.');
  if (!Number.isInteger(crf) || crf < 18 || crf > 32) {
    throw new Error('Уровень сжатия должен быть от 18 до 32.');
  }
  return { speed, crf };
}

function clipFilters(width, height, fps, options) {
  const { speed, crf } = validateOptions(options);
  return {
    video: `setpts=(PTS-STARTPTS)/${speed},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p`,
    audio: `asetpts=PTS-STARTPTS,atempo=${speed}`,
    crf: String(crf),
    speed,
  };
}

module.exports = { SPEEDS, validateOptions, clipFilters };
