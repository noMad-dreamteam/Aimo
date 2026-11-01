# Архитектура Aimo

Buildless HTML/CSS/ES modules. `index.html` подключает `src/app/main.js` и
`src/styles.css`. Манифест и service worker остаются в корне для области действия
GitHub Pages `/Aimo/`. `scripts/build.mjs` собирает `dist/` по списку runtime-файлов.

## Модули

| Каталог | Назначение | Проверки |
| --- | --- | --- |
| src/app | UI, чат, эфир, камера, профиль, OPFS и аудио | tests/app; scripts/check-browser.mjs |
| src/coach | engine, motion, policy, objects, rhythm; ответы правил и прогресс | tests/coach |
| src/ai | llm/worker, chat, planner, questions, safety | tests/ai |
| src/skills | index/common, модули навыков и синтетические позы | tests/coach |
| src/shared | Общие чистые функции без зависимости от ИИ/DOM | соответствующая предметная группа тестов |
| assets/icons | Исходная иконка, промпт и браузерные размеры | scripts/check-site.mjs |
| docs/archive | Журналы и материалы прошлого конкурса | Не являются текущими требованиями |

Приложение связывает чистые правила, навыки и ИИ. Правила тренера не зависят от
LLM; общие словоформы вынесены в shared. Внешние версии MediaPipe/WebLLM/Piper
закреплены. Сторонняя JS-сборка и лицензия находятся в src/app/vendor/.

## Потоки и контракты

1. Камера/выбранный файл → MediaPipe → наблюдение позы и COCO-объектов.
2. Только sports ball → trackBall. Поза → measure выбранного навыка.
3. stepSession → metrics, lesson, feedback. policy выбирает момент подсказки.
4. UI рисует результат, очередь голоса произносит проверенный текст.
5. buildSummary передаёт числовые измерения необязательной локальной Qwen.
6. safety и профильный validator проверяют ответ до UI/голоса/сохранения.

`analyze` возвращает quality/framing, landmarks, ball, objects, motion,
metrics, lesson, feedback и timing. Навык реализует view, measure, lessons,
errors, phrases, metric, demo, result, summaryLine и answer.

`live.js` владеет поколением запуска: все асинхронные результаты проверяют его.
Пауза сбрасывает промежуточную фазу, сохраняя счёт. Chat request привязан к чату,
смена/очистка чатов отменяет его. Model manager и trainer audio управляют workers,
скачиванием и освобождением. Состояние кеша проверяется чтением, не флагом настроек.

## Данные и совместимость
Ключи `aimo:profile`, `aimo:preferences`, `aimo:sessions`, `aimo:chats` сохранены.
Рефакторинг каталогов не мигрирует пользовательские записи. Тренировочная история
ограничена 50 записями, чат — 40 ветками по 200 сообщений. Видео в них не хранится.

## Сборка и офлайн
runtime-files.mjs перечисляет только JS/CSS, HTML, manifest, размеры иконки и
лицензию ONNX. Документы, AGENTS.md, конфиги и тестовые атаки не копируются в dist.
check-site проверяет локальные импорты, worker URL, HTML id, manifest, SHELL,
покрытие модулей офлайн-оболочкой и отсутствие посторонних файлов.
SHELL обновлён под новые пути, кеш — aimo-v52. Изменения CSS/JS требуют обновления
версии оболочки. Модели/голоса кешируются отдельно; кеш Qwen не доказывает готовность зрения.

## Оформление
`data-theme` хранит выбор light/dark/system, `data-appearance` — фактическую
светлую/тёмную тему. applyTheme обновляет её и при смене системной темы.
Дополнительные стили светлой темы ограничены `[data-appearance="light"]`.
Под нижней навигацией вне чата есть лёгкое затемнение в обеих темах;
оно перемещается/скрывается с панелью и отключается при открытой клавиатуре.
