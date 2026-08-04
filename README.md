# ART France — Intro

Windows-приложение: добавляет корпоративное интро ART France в начало видео. FFmpeg уже внутри — сотрудникам ничего устанавливать не нужно.

## Для сотрудников

1. Скачайте **`ART-France-Intro-1.0.1-portable.exe`** из [Releases](https://github.com/VovchikMusulman/artfrance-intro/releases)
2. Запустите файл двойным кликом (установка не нужна)
3. Выберите видео — готовый файл сохранится рядом: `имя_with_intro.mp4`

## Для разработчиков

```bash
npm install
# корпоративное интро: assets/intro.mp4
npm start
```

Сборка portable `.exe`:

```bash
npm run dist
```

Готовый файл: `dist/ART-France-Intro-*-portable.exe`
