**Понял.** Сделаю README **в точно таком же стиле**, как у тебя сейчас на GitHub (с оглавлением, подразделами, Permalink и т.д.), но **качественно**, с нужной информацией.

Вот готовый вариант:

---

```markdown
# CakeAI

[Permalink: CakeAI](https://github.com/SigmaNagibatorJob/Cakeai#cakeai)

### AI-ассистент с доступом к интернету

[Permalink: AI-ассистент с доступом к интернету](https://github.com/SigmaNagibatorJob/Cakeai#ai-%D0%B0%D1%81%D1%81%D0%B8%D1%81%D1%82%D0%B5%D0%BD%D1%82-%D1%81-%D0%B4%D0%BE%D1%81%D1%82%D1%83%D0%BF%D0%BE%D0%BC-%D0%BA-%D0%B8%D0%BD%D1%82%D0%B5%D1%80%D0%BD%D0%B5%D1%82%D1%83)

Десктопное приложение на Electron. Чат со стримингом, DeepThink, веб-поиск, редактор кода и файловый менеджер — всё в одном окне.

Поддержка Claude, ChatGPT, Gemini, DeepSeek и Groq.

* * *

## Содержание

[Permalink: Содержание](https://github.com/SigmaNagibatorJob/Cakeai#%D1%81%D0%BE%D0%B4%D0%B5%D1%80%D0%B6%D0%B0%D0%BD%D0%B8%D0%B5)

- [Возможности](#%D0%B2%D0%BE%D0%B7%D0%BC%D0%BE%D0%B6%D0%BD%D0%BE%D1%81%D1%82%D0%B8)
- [Полезные фишки](#%D0%BF%D0%BE%D0%BB%D0%B5%D0%B7%D0%BD%D1%8B%D0%B5-%D1%84%D0%B8%D1%88%D0%BA%D0%B8)
- [Известные баги](#%D0%B8%D0%B7%D0%B2%D0%B5%D1%81%D1%82%D0%BD%D1%8B%D0%B5-%D0%B1%D0%B0%D0%B3%D0%B8)
- [Установка](#%D1%83%D1%81%D1%82%D0%B0%D0%BD%D0%BE%D0%B2%D0%BA%D0%B0)
- [Сборка](#%D1%81%D0%B1%D0%BE%D1%80%D0%BA%D0%B0)
- [Планы на будущее](#%D0%BF%D0%BB%D0%B0%D0%BD%D1%8B-%D0%BD%D0%B0-%D0%B1%D1%83%D0%B4%D1%83%D1%89%D0%B5%D0%B5)
- [Лицензия](#%D0%BB%D0%B8%D1%86%D0%B5%D0%BD%D0%B7%D0%B8%D1%8F)

* * *

## Возможности

[Permalink: Возможности](https://github.com/SigmaNagibatorJob/Cakeai#%D0%B2%D0%BE%D0%B7%D0%BC%D0%BE%D0%B6%D0%BD%D0%BE%D1%81%D1%82%D0%B8)

### Чат

[Permalink: Чат](https://github.com/SigmaNagibatorJob/Cakeai#%D1%87%D0%B0%D1%82)

- **Streaming** — ответы приходят в реальном времени
- **DeepThink** — глубокий анализ (поддерживается у Claude и DeepSeek)
- **Search** — поиск в интернете перед ответом
- **Источники** — после ответа показываются сайты, которые использовал AI
- **Автотестирование кода** — AI запускает и исправляет Python/JS код

### Редактор и файлы

[Permalink: Редактор и файлы](https://github.com/SigmaNagibatorJob/Cakeai#%D1%80%D0%B5%D0%B4%D0%B0%D0%BA%D1%82%D0%BE%D1%80-%D0%B8-%D1%84%D0%B0%D0%B9%D0%BB%D1%8B)

- Файловый менеджер с деревом проекта
- Встроенный редактор кода
- AI может читать и редактировать файлы проекта
- Контекст проекта автоматически добавляется в чат

### Интерфейс

[Permalink: Интерфейс](https://github.com/SigmaNagibatorJob/Cakeai#%D0%B8%D0%BD%D1%82%D0%B5%D1%80%D1%84%D0%B5%D0%B9%D1%81)

- Тёмная тема
- Кастомный заголовок окна
- Смена цвета фона (RGB)
- Поддержка двух языков: Русский и English

* * *

## Полезные фишки

[Permalink: Полезные фишки](https://github.com/SigmaNagibatorJob/Cakeai#%D0%BF%D0%BE%D0%BB%D0%B5%D0%B7%D0%BD%D1%8B%D0%B5-%D1%84%D0%B8%D1%88%D0%BA%D0%B8)

- При включённом **Search** AI говорит «У меня есть доступ к интернету»
- После ответа появляется блок с **источниками** (названия сайтов + ссылки)
- Автоматическая проверка и исправление кода (до 3 попыток)
- При смене провайдера показывается предупреждение
- Цвет текста автоматически подстраивается под фон

* * *

## Известные баги

[Permalink: Известные баги](https://github.com/SigmaNagibatorJob/Cakeai#%D0%B8%D0%B7%D0%B2%D0%B5%D1%81%D1%82%D0%BD%D1%8B%D0%B5-%D0%B1%D0%B0%D0%B3%D0%B8)

### Заметные баги (будут исправлены)

| Баг | Описание | Статус |
|-----|----------|--------|
| Медленный поиск | Поиск иногда работает медленно | В планах |
| Источники не всегда показываются | Блок с источниками иногда не появляется | Будет исправлено |
| Неполный перевод | Часть интерфейса остаётся на русском при English | Средний приоритет |
| Один чат одновременно | Нельзя открыть несколько чатов | Планируется |

### Мелкие баги

- Проблемы с форматированием очень длинного кода
- Терминал без автодополнения
- При удалении файла иногда остаётся вкладка
- Модалки не всегда закрываются по клику вне окна

* * *

## Установка

[Permalink: Установка](https://github.com/SigmaNagibatorJob/Cakeai#%D1%83%D1%81%D1%82%D0%B0%D0%BD%D0%BE%D0%B2%D0%BA%D0%B0)

```bash
git clone https://github.com/SigmaNagibatorJob/Cakeai.git
cd Cakeai
npm install
npm start
```

* * *

## Сборка

[Permalink: Сборка](https://github.com/SigmaNagibatorJob/Cakeai#%D1%81%D0%B1%D0%BE%D1%80%D0%BA%D0%B0)

```bash
npm run build          # Установщик + portable
npm run build-portable # Только portable
```

* * *

## Планы на будущее

[Permalink: Планы на будущее](https://github.com/SigmaNagibatorJob/Cakeai#%D0%BF%D0%BB%D0%B0%D0%BD%D1%8B-%D0%BD%D0%B0-%D0%B1%D1%83%D0%B4%D1%83%D1%89%D0%B5%D0%B5)

- Полная локализация интерфейса
- Встроенный браузер
- Поддержка локальных моделей (Ollama)
- Плагины и темы

* * *

## Лицензия

[Permalink: Лицензия]([https://github.com/SigmaNagibatorJob/Cakeai#%D0%BB%D0%B8%D1%86%D0%B5%D0%BD%D0%B7%D0%B8%D1%8F](https://github.com/SigmaNagibatorJob/Cakeai?tab=MIT-1-ov-file))

MIT License
```

---

Скопируй этот текст и замени им текущий `README.md` в репозитории.

Хочешь, чтобы я ещё что-то подправил в этом варианте?
