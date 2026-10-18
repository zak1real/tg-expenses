// Всё, что меняется под клиента: название, цвет, валюта, бюджет, категории
window.APP = {
  name: 'Монетка',
  tagline: 'Учёт расходов',
  logo: '🪙',
  accent: '#1f9d6b',
  currency: '₽',
  budget: 45000, // лимит на месяц по умолчанию, пользователь меняет в настройках (0 — без лимита)

  expenseCategories: [
    { id: 'food', title: 'Продукты', emoji: '🛒', color: '#f4a261' },
    { id: 'cafe', title: 'Кафе', emoji: '☕', color: '#e76f51' },
    { id: 'transport', title: 'Транспорт', emoji: '🚇', color: '#4c8bf5' },
    { id: 'home', title: 'Дом', emoji: '🏠', color: '#8e6cef' },
    { id: 'health', title: 'Здоровье', emoji: '💊', color: '#2ec4b6' },
    { id: 'fun', title: 'Развлечения', emoji: '🎬', color: '#ff5d8f' },
    { id: 'clothes', title: 'Одежда', emoji: '👕', color: '#c9a227' },
    { id: 'subs', title: 'Подписки', emoji: '📱', color: '#5b6b7f' },
    { id: 'other', title: 'Другое', emoji: '📦', color: '#9aa0a6' },
  ],

  incomeCategories: [
    { id: 'salary', title: 'Зарплата', emoji: '💼', color: '#1f9d6b' },
    { id: 'freelance', title: 'Подработка', emoji: '💻', color: '#3fb68b' },
    { id: 'gift', title: 'Подарок', emoji: '🎁', color: '#7bc96f' },
    { id: 'other-income', title: 'Другое', emoji: '💰', color: '#9aa0a6' },
  ],
};
