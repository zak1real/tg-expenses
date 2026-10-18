(function () {
  'use strict';

  const app = window.APP;
  const store = window.createStore('tg-expenses-');
  const tg = window.Telegram && window.Telegram.WebApp;
  // SDK загружается и в браузере, но platform там 'unknown'
  const inTelegram = Boolean(tg && tg.platform && tg.platform !== 'unknown');

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const numberFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  const money = (n) => numberFmt.format(n) + ' ' + app.currency;

  const allCategories = [...app.expenseCategories, ...app.incomeCategories];
  const categoriesById = Object.fromEntries(allCategories.map((c) => [c.id, c]));
  const categoriesOf = (type) => (type === 'income' ? app.incomeCategories : app.expenseCategories);

  // ---------- Даты ----------

  const pad = (n) => String(n).padStart(2, '0');
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function monthKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function parseDate(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }

  // ?demo — сразу пример данных без вступления (для скриншотов и показа клиентам)
  const demoLink = new URLSearchParams(location.search).has('demo');

  const state = {
    ops: store.peek('ops') || [], // { id, type: 'expense' | 'income', amount, cat, date: 'YYYY-MM-DD', note, ts }
    settings: store.peek('settings') || { budget: app.budget },
    month: monthKey(new Date()), // 'YYYY-MM'
    filter: 'all',
    cat: null, // фильтр по категории из диаграммы
    sheet: null, // { kind: 'op', draft } | { kind: 'settings' }
    intro: null, // номер экрана вступления, null — вступление закрыто
  };

  const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' });

  function monthTitle(key) {
    const [y, m] = key.split('-').map(Number);
    return MONTHS[m - 1] + (y === new Date().getFullYear() ? '' : ' ' + y);
  }

  function shiftMonth(key, delta) {
    const [y, m] = key.split('-').map(Number);
    return monthKey(new Date(y, m - 1 + delta, 1));
  }

  function dayTitle(iso) {
    const today = new Date();
    if (iso === isoDate(today)) return 'Сегодня';
    if (iso === isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1))) return 'Вчера';
    return dayFmt.format(parseDate(iso));
  }

  // ---------- Данные ----------

  const monthOps = () => state.ops.filter((o) => o.date.slice(0, 7) === state.month);
  const sumOf = (list) => list.reduce((a, o) => a + o.amount, 0);

  function saveOps() { store.save('ops', state.ops); }
  function saveSettings() { store.save('settings', state.settings); }

  // Пример данных за прошлый и текущий месяц, чтобы приложение не было пустым при первом запуске
  function demoOps() {
    let seed = 42;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const between = (a, b, step) => Math.round((a + rnd() * (b - a)) / (step || 10)) * (step || 10);

    const ops = [];
    const today = new Date();
    const add = (d, type, cat, amount, note) => {
      const ts = d.getTime() + ops.length;
      ops.push({ id: 'demo' + ops.length, type, cat, amount, date: isoDate(d), note, ts });
    };

    for (let d = new Date(today.getFullYear(), today.getMonth() - 1, 1); d <= today; d.setDate(d.getDate() + 1)) {
      const day = d.getDate();
      const weekend = d.getDay() === 0 || d.getDay() === 6;
      if (day === 5) add(d, 'income', 'salary', 48000, 'Зарплата');
      if (day === 20) add(d, 'income', 'salary', 32000, 'Аванс');
      if (day === 14 && rnd() < 0.6) add(d, 'income', 'freelance', between(6000, 15000, 500), 'Заказ на фрилансе');
      if (day === 3) { add(d, 'expense', 'subs', 399, 'Музыка и кино'); add(d, 'expense', 'home', 650, 'Интернет'); }
      if (day === 10) add(d, 'expense', 'home', 5480, 'Коммуналка');
      if (day === 12) add(d, 'expense', 'subs', 149, 'Облако для фото');
      if (rnd() < 0.35) add(d, 'expense', 'food', between(400, 2200), pick(['Пятёрочка', 'Перекрёсток', 'ВкусВилл', 'Магнит', 'Рынок']));
      if (!weekend && rnd() < 0.5) add(d, 'expense', 'cafe', between(180, 650), pick(['Кофе', 'Обед', 'Кофе с собой', 'Шаурма']));
      if (weekend && rnd() < 0.35) add(d, 'expense', 'cafe', between(900, 2800), pick(['Ужин с друзьями', 'Бранч', 'Пицца']));
      if (!weekend && rnd() < 0.6) add(d, 'expense', 'transport', 140, 'Метро');
      if (rnd() < 0.08) add(d, 'expense', 'transport', between(350, 900), 'Такси');
      if (rnd() < 0.06) add(d, 'expense', 'health', between(300, 1500), 'Аптека');
      if (rnd() < 0.07) add(d, 'expense', 'fun', between(500, 2500), pick(['Кино', 'Боулинг', 'Концерт', 'Игра в Steam']));
      if (rnd() < 0.03) add(d, 'expense', 'clothes', between(1500, 6000, 100), pick(['Кроссовки', 'Футболка', 'Куртка']));
      if (rnd() < 0.04) add(d, 'expense', 'other', between(300, 2000), pick(['Подарок другу', 'Стрижка', 'Канцтовары']));
    }
    return ops;
  }

  // ---------- Telegram ----------

  const tgCan = (version) => inTelegram && tg.isVersionAtLeast(version);

  function haptic(kind) {
    if (!tgCan('6.1')) return;
    if (kind === 'success' || kind === 'error' || kind === 'warning') tg.HapticFeedback.notificationOccurred(kind);
    else tg.HapticFeedback.impactOccurred(kind);
  }

  function confirmAsk(text) {
    if (tgCan('6.2')) return new Promise((resolve) => tg.showConfirm(text, resolve));
    return Promise.resolve(window.confirm(text));
  }

  let mainAction = null;

  // В Telegram — нативная кнопка внизу, в браузере — своя
  function setMainButton(text, action) {
    mainAction = action || null;
    if (inTelegram) {
      if (text) {
        tg.MainButton.setText(text);
        tg.MainButton.show();
      } else {
        tg.MainButton.hide();
      }
    } else {
      $('bottomBar').hidden = !text;
      $('mainBtn').textContent = text || '';
    }
    document.body.classList.toggle('has-bottom-bar', !inTelegram && Boolean(text));
  }

  function updateChrome() {
    if (tgCan('6.1')) {
      if (state.sheet || state.intro > 0) tg.BackButton.show();
      else tg.BackButton.hide();
    }
    if (state.intro !== null) {
      return setMainButton(state.intro === INTRO.length - 1 ? 'Начать' : 'Далее', () => showIntro(state.intro + 1));
    }
    setMainButton(state.sheet ? null : 'Добавить операцию', () => openOp(null));
  }

  function initTelegram() {
    if (!inTelegram) return;
    tg.ready();
    tg.expand();
    tg.MainButton.setParams({ color: app.accent, text_color: '#ffffff' });
    tg.MainButton.onClick(() => mainAction && mainAction());
    if (tgCan('6.1')) tg.BackButton.onClick(goBack);
  }

  function goBack() {
    if (state.sheet) return closeSheet();
    if (state.intro > 0) showIntro(state.intro - 1);
  }

  // ---------- Вступление для нового пользователя ----------

  const sampleCat = (id) => categoriesById[id] || categoriesById.other;
  const sampleOp = (cat, title, amount, income) => `<div class="op">
      <span class="op__icon" style="--c:${sampleCat(cat).color}">${sampleCat(cat).emoji}</span>
      <span class="op__info"><span class="op__title">${title}</span><span class="op__meta">${esc(sampleCat(cat).title)}</span></span>
      <span class="op__amount${income ? ' is-plus' : ''}">${income ? '+' : '−'}${money(amount)}</span>
    </div>`;
  const sampleParts = [['food', 6990], ['home', 6130], ['cafe', 5380], ['transport', 1950]]
    .map(([id, sum]) => ({ ...sampleCat(id), sum }));

  const INTRO = [
    {
      icon: app.logo,
      title: `Привет! Это ${app.name}`,
      text: 'Учёт расходов прямо в Telegram. Всё, что ты запишешь, видишь только ты — данные хранятся в твоём аккаунте.',
    },
    {
      icon: '✍️',
      title: 'Записывай траты',
      text: 'Нажми «Добавить операцию», введи сумму и выбери категорию. Доходы записываются так же. Нажми на операцию, чтобы исправить её.',
      demo: `<div class="intro-demo">${sampleOp('cafe', 'Кофе с собой', 250)}${sampleOp('salary', 'Зарплата', 48000, true)}</div>`,
    },
    {
      icon: '🎯',
      title: 'Держи бюджет',
      text: 'Задай лимит на месяц в настройках (кнопка справа вверху) — приложение подскажет, сколько можно тратить в день.',
      demo: `<div class="intro-demo intro-demo--pad">
        <div class="bar"><div class="bar__fill" style="width:55%"></div></div>
        <p class="bar__caption">Осталось ${money(20000)} из ${money(45000)} · ~${money(1430)} в день</p>
      </div>`,
    },
    {
      icon: '📊',
      title: 'Смотри, куда уходят деньги',
      text: 'Диаграмма по категориям обновляется сама. Нажми на категорию — и останутся только её операции.',
      demo: `<div class="intro-demo intro-demo--pad intro-demo--chart">
        <div class="donut">${donutHtml(sampleParts, 20450)}</div>
        <div class="legend">${sampleParts.map((p) => `<div class="legend__row">
          <span class="legend__dot" style="background:${p.color}"></span>
          <span class="legend__title">${p.emoji} ${esc(p.title)}</span>
          <span class="legend__pct">${Math.round((p.sum / 20450) * 100)}%</span>
        </div>`).join('')}</div>
      </div>`,
    },
  ];

  function showIntro(index) {
    if (index >= INTRO.length) return closeIntro();
    const back = state.intro !== null && index < state.intro;
    state.intro = index;
    const s = INTRO[index];
    $('intro').hidden = false;
    $('introSlide').innerHTML = `
      <div class="intro__slide${back ? ' is-back' : ''}">
        <div class="intro__icon">${s.icon}</div>
        <h2 class="intro__title">${esc(s.title)}</h2>
        <p class="intro__text">${esc(s.text)}</p>
        ${s.demo || ''}
      </div>`;
    $('introDots').innerHTML = INTRO.map((_, i) => `<i class="${i === index ? 'is-active' : ''}"></i>`).join('');
    $('introSkip').hidden = index === INTRO.length - 1;
    haptic('light');
    updateChrome();
  }

  function closeIntro() {
    state.intro = null;
    $('intro').hidden = true;
    window.scrollTo(0, 0);
    render();
  }

  // ---------- Отрисовка ----------

  function render() {
    const current = monthKey(new Date());
    $('monthTitle').textContent = monthTitle(state.month);
    document.querySelector('[data-month="1"]').disabled = state.month >= current;
    document.querySelectorAll('[data-filter]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.filter === state.filter);
    });
    renderSummary();
    renderChart();
    renderList();
    updateChrome();
  }

  function renderSummary() {
    const ops = monthOps();
    const spent = sumOf(ops.filter((o) => o.type === 'expense'));
    const income = sumOf(ops.filter((o) => o.type === 'income'));
    const balance = income - spent;
    const budget = state.settings.budget;

    let budgetHtml = '';
    if (budget > 0) {
      const share = spent / budget;
      const left = budget - spent;
      const now = new Date();
      let caption;
      if (left < 0) {
        caption = `Перерасход ${money(-left)} из ${money(budget)}`;
      } else if (state.month === monthKey(now)) {
        const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
        caption = `Осталось ${money(left)} из ${money(budget)} · ~${money(Math.floor(left / daysLeft))} в день`;
      } else {
        caption = `Уложились в бюджет, осталось ${money(left)}`;
      }
      budgetHtml = `
        <div class="bar${share > 1 ? ' is-over' : share > 0.85 ? ' is-warn' : ''}">
          <div class="bar__fill" style="width:${Math.min(100, share * 100).toFixed(1)}%"></div>
        </div>
        <p class="bar__caption">${caption}</p>`;
    }

    $('summary').innerHTML = `
      <p class="summary__label">Расходы за месяц</p>
      <p class="summary__amount">${money(spent)}</p>
      <div class="summary__stats">
        <div><span>Доходы</span><b class="is-plus">${income ? '+' : ''}${money(income)}</b></div>
        <div><span>Остаток</span><b class="${balance < 0 ? 'is-minus' : ''}">${balance > 0 ? '+' : ''}${money(balance)}</b></div>
      </div>
      ${budgetHtml}`;
  }

  function donutHtml(parts, total) {
    const r = 52;
    const length = 2 * Math.PI * r;
    const gap = parts.length > 1 ? 2 : 0;
    let offset = 0;
    const arcs = parts.map((p) => {
      const len = (p.sum / total) * length;
      const arc = `<circle r="${r}" cx="60" cy="60" fill="none" stroke="${p.color}" stroke-width="14"
        stroke-dasharray="${Math.max(len - gap, 0.5).toFixed(2)} ${length.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"/>`;
      offset += len;
      return arc;
    }).join('');
    return `<svg class="donut__svg" viewBox="0 0 120 120" aria-hidden="true"><g transform="rotate(-90 60 60)">${arcs}</g></svg>`;
  }

  function renderChart() {
    const expenses = monthOps().filter((o) => o.type === 'expense');
    const total = sumOf(expenses);
    if (!total) {
      $('chart').hidden = true;
      return;
    }
    const sums = {};
    expenses.forEach((o) => { sums[o.cat] = (sums[o.cat] || 0) + o.amount; });
    const parts = Object.entries(sums)
      .map(([id, sum]) => ({ ...(categoriesById[id] || categoriesById.other), sum }))
      .sort((a, b) => b.sum - a.sum);

    $('chart').hidden = false;
    $('chart').innerHTML = `
      <div class="donut">
        ${donutHtml(parts, total)}
        <div class="donut__center"><b>${parts.length}</b><span>${plural(parts.length, 'категория', 'категории', 'категорий')}</span></div>
      </div>
      <div class="legend">
        ${parts.map((p) => `
          <button type="button" class="legend__row${state.cat === p.id ? ' is-active' : ''}" data-cat="${p.id}">
            <span class="legend__dot" style="background:${p.color}"></span>
            <span class="legend__title">${p.emoji} ${esc(p.title)}</span>
            <span class="legend__pct">${Math.round((p.sum / total) * 100)}%</span>
            <span class="legend__sum">${money(p.sum)}</span>
          </button>`).join('')}
      </div>`;
  }

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function opHtml(o) {
    const c = categoriesById[o.cat] || categoriesById.other;
    const sign = o.type === 'income' ? '+' : '−';
    return `<button type="button" class="op" data-op="${o.id}">
      <span class="op__icon" style="--c:${c.color}">${c.emoji}</span>
      <span class="op__info">
        <span class="op__title">${esc(o.note || c.title)}</span>
        ${o.note ? `<span class="op__meta">${esc(c.title)}</span>` : ''}
      </span>
      <span class="op__amount${o.type === 'income' ? ' is-plus' : ''}">${sign}${money(o.amount)}</span>
    </button>`;
  }

  function renderList() {
    const cat = state.cat && categoriesById[state.cat];
    $('catFilter').innerHTML = cat
      ? `<button type="button" class="chip is-active" data-cat-clear>${cat.emoji} ${esc(cat.title)} <span aria-hidden="true">✕</span></button>`
      : '';

    const list = monthOps()
      .filter((o) => (state.filter === 'all' || o.type === state.filter) && (!state.cat || o.cat === state.cat))
      .sort((a, b) => (a.date === b.date ? b.ts - a.ts : a.date < b.date ? 1 : -1));

    if (!list.length) {
      $('opsList').innerHTML = `<div class="empty-state">
        <div class="empty-state__icon">🧾</div>
        <p>${state.ops.length ? 'Здесь пока ничего нет' : 'Добавьте первую трату кнопкой «Добавить операцию» — и появится статистика'}</p>
      </div>`;
      return;
    }

    const days = [];
    list.forEach((o) => {
      const last = days[days.length - 1];
      if (last && last.date === o.date) last.ops.push(o);
      else days.push({ date: o.date, ops: [o] });
    });

    $('opsList').innerHTML = days.map((d) => {
      const spent = sumOf(d.ops.filter((o) => o.type === 'expense'));
      return `<div class="day">
        <div class="day__head"><span>${dayTitle(d.date)}</span><span>${spent ? '−' + money(spent) : ''}</span></div>
        ${d.ops.map(opHtml).join('')}
      </div>`;
    }).join('');
  }

  // ---------- Шторка ----------

  function openSheet(sheet) {
    state.sheet = sheet;
    renderSheet();
    const el = $('sheet');
    el.hidden = false;
    void el.offsetWidth; // чтобы сработала анимация появления
    el.classList.add('is-open');
    haptic('light');
    updateChrome();
  }

  function closeSheet() {
    if (!state.sheet) return;
    state.sheet = null;
    $('sheet').classList.remove('is-open');
    setTimeout(() => { if (!state.sheet) $('sheet').hidden = true; }, 250);
    updateChrome();
  }

  function renderSheet() {
    $('sheetBody').innerHTML = state.sheet.kind === 'op' ? opFormHtml() : settingsHtml();
  }

  function openOp(id) {
    const existing = id && state.ops.find((o) => o.id === id);
    let date = isoDate(new Date());
    if (state.month !== monthKey(new Date())) {
      // смотрим прошлый месяц — по умолчанию его последний день
      const [y, m] = state.month.split('-').map(Number);
      date = isoDate(new Date(y, m, 0));
    }
    const draft = existing
      ? { ...existing, amountText: String(existing.amount).replace('.', ',') }
      : { id: null, type: state.filter === 'income' ? 'income' : 'expense', cat: null, date, note: '', amountText: '' };
    if (!draft.cat) draft.cat = categoriesOf(draft.type)[0].id;
    openSheet({ kind: 'op', draft });
    if (!existing) setTimeout(() => $('opAmount') && $('opAmount').focus(), 260);
  }

  function opFormHtml() {
    const d = state.sheet.draft;
    return `
      <h2 class="sheet__title">${d.id ? 'Операция' : 'Новая операция'}</h2>
      <div class="segmented">
        <button type="button" data-type="expense" class="${d.type === 'expense' ? 'is-active' : ''}">Расход</button>
        <button type="button" data-type="income" class="${d.type === 'income' ? 'is-active' : ''}">Доход</button>
      </div>
      <label class="amount${d.error ? ' has-error' : ''}">
        <input id="opAmount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(d.amountText)}" aria-label="Сумма" style="width:${amountWidth(d.amountText)}">
        <span>${app.currency}</span>
      </label>
      <p class="amount__error">${d.error || ''}</p>
      <div class="cats">
        ${categoriesOf(d.type).map((c) => `
          <button type="button" class="cat${c.id === d.cat ? ' is-active' : ''}" data-pick-cat="${c.id}" style="--c:${c.color}">
            <span class="cat__icon">${c.emoji}</span>
            <span class="cat__title">${esc(c.title)}</span>
          </button>`).join('')}
      </div>
      <div class="field">
        <label for="opDate">Дата</label>
        <input id="opDate" type="date" value="${d.date}" max="${isoDate(new Date())}">
      </div>
      <div class="field">
        <label for="opNote">Комментарий</label>
        <input id="opNote" maxlength="60" autocomplete="off" placeholder="Например: обед с коллегами" value="${esc(d.note)}">
      </div>
      <div class="sheet__footer">
        ${d.id ? '<button type="button" class="danger-btn" data-sheet="delete" aria-label="Удалить">Удалить</button>' : ''}
        <button type="button" class="primary-btn" data-sheet="save">${d.id ? 'Сохранить' : 'Добавить'}</button>
      </div>`;
  }

  // поле суммы растёт вместе с числом, чтобы знак валюты стоял рядом
  const amountWidth = (text) => Math.min(Math.max(String(text).length, 1) + 0.6, 11) + 'ch';

  function parseAmount(text) {
    const n = parseFloat(String(text).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  }

  function saveOp() {
    const d = state.sheet.draft;
    const amount = parseAmount(d.amountText);
    if (!(amount > 0) || amount >= 1e9) {
      d.error = 'Введите сумму';
      haptic('error');
      renderSheet();
      $('opAmount').focus();
      return;
    }
    const op = {
      id: d.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: d.type,
      amount,
      cat: d.cat,
      date: d.date || isoDate(new Date()),
      note: d.note.trim(),
      ts: d.ts || Date.now(),
    };
    const index = state.ops.findIndex((o) => o.id === op.id);
    if (index >= 0) state.ops[index] = op;
    else state.ops.push(op);
    saveOps();

    state.month = op.date.slice(0, 7); // показываем месяц, куда попала операция
    haptic('success');
    closeSheet();
    toast(index >= 0 ? 'Сохранено' : (op.type === 'income' ? 'Доход добавлен' : 'Расход добавлен'));
    render();
  }

  async function deleteOp() {
    const id = state.sheet.draft.id;
    if (!(await confirmAsk('Удалить операцию?'))) return;
    state.ops = state.ops.filter((o) => o.id !== id);
    saveOps();
    haptic('warning');
    closeSheet();
    toast('Удалено');
    render();
  }

  function settingsHtml() {
    return `
      <h2 class="sheet__title">Настройки</h2>
      <div class="field">
        <label for="budgetInput">Бюджет на месяц, ${app.currency}</label>
        <input id="budgetInput" inputmode="numeric" autocomplete="off" value="${state.settings.budget || ''}" placeholder="Без лимита">
      </div>
      <button type="button" class="primary-btn primary-btn--block" data-sheet="budget">Сохранить</button>
      <p class="sheet__note">${store.isCloud
        ? 'Данные хранятся в облаке Telegram и доступны на всех ваших устройствах.'
        : 'В браузере данные хранятся только на этом устройстве. В Telegram — в облаке и на всех устройствах.'}</p>
      <div class="sheet__actions">
        <button type="button" class="secondary-btn" data-sheet="intro">Как пользоваться</button>
        <button type="button" class="secondary-btn" data-sheet="demo">Заполнить примером</button>
        <button type="button" class="secondary-btn secondary-btn--danger" data-sheet="clear">Удалить все операции</button>
      </div>`;
  }

  async function sheetAction(action) {
    switch (action) {
      case 'save':
        return saveOp();
      case 'delete':
        return deleteOp();
      case 'intro':
        closeSheet();
        return showIntro(0);
      case 'budget': {
        const value = parseAmount($('budgetInput').value);
        state.settings.budget = value > 0 ? Math.round(value) : 0;
        saveSettings();
        haptic('success');
        closeSheet();
        toast('Бюджет сохранён');
        return render();
      }
      case 'demo':
        if (state.ops.length && !(await confirmAsk('Заменить ваши операции примером?'))) return;
        state.ops = demoOps();
        break;
      case 'clear':
        if (!(await confirmAsk('Удалить все операции? Это нельзя отменить.'))) return;
        state.ops = [];
        break;
    }
    saveOps();
    state.month = monthKey(new Date());
    state.cat = null;
    haptic('success');
    closeSheet();
    render();
  }

  // ---------- Прочее ----------

  let toastTimer;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 1600);
  }

  function bindEvents() {
    document.querySelectorAll('[data-month]').forEach((b) => b.addEventListener('click', () => {
      state.month = shiftMonth(state.month, Number(b.dataset.month));
      state.cat = null;
      haptic('light');
      render();
    }));

    $('typeFilter').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-filter]');
      if (!btn) return;
      state.filter = btn.dataset.filter;
      haptic('light');
      render();
    });

    $('chart').addEventListener('click', (e) => {
      const row = e.target.closest('[data-cat]');
      if (!row) return;
      state.cat = state.cat === row.dataset.cat ? null : row.dataset.cat;
      if (state.cat) state.filter = 'all';
      haptic('light');
      render();
    });

    $('catFilter').addEventListener('click', () => {
      state.cat = null;
      render();
    });

    $('opsList').addEventListener('click', (e) => {
      const row = e.target.closest('[data-op]');
      if (row) openOp(row.dataset.op);
    });

    $('sheet').addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) return closeSheet();
      const d = state.sheet && state.sheet.draft;
      const type = e.target.closest('[data-type]');
      if (type && d.type !== type.dataset.type) {
        d.type = type.dataset.type;
        d.cat = categoriesOf(d.type)[0].id;
        haptic('light');
        return renderSheet();
      }
      const cat = e.target.closest('[data-pick-cat]');
      if (cat) {
        d.cat = cat.dataset.pickCat;
        haptic('light');
        return renderSheet();
      }
      const action = e.target.closest('[data-sheet]');
      if (action) sheetAction(action.dataset.sheet);
    });

    // запоминаем ввод, чтобы он не терялся при перерисовке шторки
    $('sheet').addEventListener('input', (e) => {
      const d = state.sheet && state.sheet.draft;
      if (!d) return;
      if (e.target.id === 'opAmount') {
        d.amountText = e.target.value;
        e.target.style.width = amountWidth(d.amountText);
        if (d.error) {
          d.error = '';
          e.target.closest('.amount').classList.remove('has-error');
          document.querySelector('.amount__error').textContent = '';
        }
      }
      if (e.target.id === 'opDate') d.date = e.target.value;
      if (e.target.id === 'opNote') d.note = e.target.value;
    });

    $('sheet').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        e.preventDefault();
        sheetAction(state.sheet.kind === 'op' ? 'save' : 'budget');
      }
    });

    $('settingsBtn').addEventListener('click', () => openSheet({ kind: 'settings' }));
    $('mainBtn').addEventListener('click', () => mainAction && mainAction());
    $('introSkip').addEventListener('click', closeIntro);
    $('introDots').addEventListener('click', (e) => {
      const dot = e.target.closest('i');
      if (dot) showIntro([...$('introDots').children].indexOf(dot));
    });

    // листание вступления свайпом
    let touchX = null;
    $('intro').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
    $('intro').addEventListener('touchend', (e) => {
      if (touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      touchX = null;
      if (dx < -50) showIntro(state.intro + 1);
      else if (dx > 50 && state.intro > 0) showIntro(state.intro - 1);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSheet();
      if (state.intro === null || state.sheet) return;
      if (e.key === 'ArrowRight') showIntro(state.intro + 1);
      if (e.key === 'ArrowLeft' && state.intro > 0) showIntro(state.intro - 1);
    });
  }

  async function init() {
    document.documentElement.style.setProperty('--accent', app.accent);
    document.title = app.name;
    $('appName').textContent = app.name;
    $('appLogo').textContent = app.logo;
    const user = inTelegram && tg.initDataUnsafe && tg.initDataUnsafe.user;
    $('greeting').textContent = user ? `Привет, ${user.first_name}!` : app.tagline;

    initTelegram();
    bindEvents();
    render();

    // подтягиваем данные из облака Telegram; при самом первом запуске — вступление (или пример по ссылке ?demo)
    try {
      const [ops, settings] = await Promise.all([store.load('ops'), store.load('settings')]);
      if (settings) state.settings = settings;
      state.ops = ops || (demoLink ? demoOps() : []);
      if (!ops) {
        saveOps();
        if (!demoLink) showIntro(0);
      }
    } catch (e) {
      toast('Не удалось загрузить данные из облака');
    }
    render();
  }

  init();
})();
