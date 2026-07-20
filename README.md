# ART France Intro

Windows-приложение: добавляет корпоративное интро в начало видео.  
FFmpeg встроен — сотрудникам ничего устанавливать не нужно.

## Для сотрудников

Скачайте `.exe` из [Releases](../../releases) и запустите двойным кликом.

Готовый файл сохраняется рядом с исходником: `имя_with_intro.mp4`.

## Для разработки

```bash
npm install
# корпоративное интро: assets/intro.mp4
npm start
```

Сборка portable `.exe`:

```bash
npm run dist
```

Результат: `dist/ART-France-Intro-*-portable.exe`
