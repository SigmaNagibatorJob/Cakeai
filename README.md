# 🍰 CakeAI

Десктопный AI-ассистент на Electron с поддержкой нескольких провайдеров, встроенным редактором кода и менеджером файлов.

> Ассистент внутри — **Lungskull** 🦴

![Version](https://img.shields.io/badge/version-2.0-7ee8a2)
![Electron](https://img.shields.io/badge/Electron-28+-47848?logo=electron)
![License](https://img.shields.io/badge/license-MIT-blue)

## ✨ Возможности

- 🤖 **Мультипровайдерный AI** — Claude, ChatGPT, Gemini, DeepSeek, Groq из одной коробки
- 🔄 **Стриминг ответов** в реальном времени
- 📁 **Файловый менеджер** + встроенный редактор кода
- 🔐 **Шифрованная история чатов** (AES-256-GCM, ключ привязан к машине)
- 🔍 **Умный поиск** — по файлам проекта, истории чатов и через AI в интернете
- 🧠 **DeepThink режим** — глубокое размышление для сложных задач
- 🌐 **Web Search** — запрос актуальной информации через AI
- ⚙️ **Автопроверка кода** — Python и JS код автоматически тестируется и исправляется
- 🎨 **Кастомный системный промпт**
- 🎯 **Выбор конкретной модели** у каждого провайдера
- 🖥️ **Нативный UI** в стиле macOS с кастомным titlebar

## 📸 Скриншоты

<!-- Добавь скриншоты в папку screenshots/ -->
<p align="center">
  <img src="screenshots/main.png" width="48%" />
  <img src="screenshots/editor.png" width="48%" />
</p>

## 🚀 Установка

### Требования
- [Node.js](https://nodejs.org/) 18+
- npm или yarn

### Запуск

```bash
git clone https://github.com/Cakein228/cakeai.git
cd cakeai
npm install
npm start
```

### Сборка в .exe

```bash
npm run build
```

## 🔑 API ключи

Поддерживаются ключи:
| Провайдер | Формат ключа |
|-----------|--------------|
| Claude | `sk-ant-...` |
| ChatGPT | `sk-proj-...` (длинный) |
| Gemini | `AIza...` |
| DeepSeek | `sk-...` (короткий) или `dsk-...` |
| Groq | `gsk_...` |

Ключ хранится в `localStorage`, история чатов шифруется локальным машинным ключом.

## 🛠️ Технологии

- **Electron** — десктоп-оболочка
- **Vanilla JS** — без фреймворков, чистый код
- **Node.js crypto** — AES-256-GCM шифрование
- **HTTPS API** — прямые запросы к провайдерам без бэкенда

## 📂 Структура

```
main.js        — главный процесс Electron, IPC, работа с AI API
preload.js     — безопасный мост API
src/
  index.html   — разметка
  style.css    — стили (тёмная тема)
  app.js       — инициализация
  chat.js      — логика чата и стриминга
  files.js     — файловый менеджер
  editor.js    — редактор кода
  workspace.js — вкладки
  search.js    — поиск (файлы/история/веб)
  history.js   — история чатов
  settings.js  — настройки и выбор моделей
```

## 📄 Лицензия

MIT © [Cakein228](https://github.com/Cakein228)

## 💬 Автор

Сделано с ❤️ by **Cakein228**
