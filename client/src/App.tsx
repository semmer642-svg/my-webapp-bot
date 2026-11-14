import { useEffect, useState } from 'react';

declare global { interface Window { Telegram?: any } }

// Адрес вашего сервера на Render
const API_URL = "https://my-webapp-bot-cr76.onrender.com";

type Profile = { id: string; displayName: string; coin: number; xp: number; level: number; stats: { attack: number; defense: number; health: number }; power: number };

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [message, setMessage] = useState('Подключаем профиль…');
  const [search, setSearch] = useState(false);
  const [offer, setOffer] = useState(false);
  const [match, setMatch] = useState<any>(null);

  // Универсальная функция для запросов
  async function api(path: string, body?: any) {
    const tg = window.Telegram?.WebApp;
    const initData = tg?.initData || '';
    
    // Не выбрасываем ошибку сразу, если initData пустой, 
    // чтобы дать шанс серверу ответить (вдруг он это обработает)
    if (!initData) {
      console.warn("initData пуст, но пробуем отправить запрос");
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 секунд на "пробуждение" Render

    try {
      const r = await fetch(`${API_URL}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 
          'Content-Type': 'application/json', 
          'x-telegram-init-data': initData || '' 
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Ошибка запроса');
      return d;
    } catch (e: any) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        throw new Error("Сервер просыпается. Подождите и попробуйте снова.");
      }
      throw e;
    }
  }

  async function load() {
    try {
      const tg = window.Telegram?.WebApp;
      if (tg) {
        tg.ready();
        tg.expand();
      }

      // Ждем, пока Telegram передаст initData (актуально для iOS)
      let initData = tg?.initData || '';
      let attempts = 0;
      while (!initData && attempts < 15) {
        await new Promise(r => setTimeout(r, 200));
        initData = window.Telegram?.WebApp?.initData || '';
        attempts++;
      }

      if (!initData) {
        setMessage('Telegram не передал данные. Попробуйте перезапустить бота.');
        return;
      }

      const p = await api('/api/me');
      setProfile(p);
      setMessage('Готов к бою!');
    } catch (e: any) {
      setMessage(e.message || 'Не удалось войти.');
    }
  }

  // Логика запуска с учетом бага iOS 18
  useEffect(() => {
    let isMounted = true;

    const startLoad = () => {
      if (!isMounted) return;
      // Дополнительная задержка, чтобы Telegram успел все передать
      setTimeout(() => load(), 500);
    };

    // Если страница уже видима
    if (document.visibilityState === 'visible') {
      startLoad();
    } else {
      // Ждем, пока страница станет видимой
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          document.removeEventListener('visibilitychange', handleVisibilityChange);
          startLoad();
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      isMounted = false;
    };
  }, []);

  async function upgrade(stat: string) {
    try { await api('/api/upgrade', { stat }); await load(); } catch (e: any) { setMessage(e.message) }
  }

  async function find() {
    try {
      setSearch(true); setOffer(false); setMessage('Ищем соперника…');
      const start = Date.now(); let d: any;
      do {
        d = await api('/api/match/queue', {});
        if (d.status === 'bot_offer') { setOffer(true); setMessage(d.message); break }
        if (d.status === 'matched') { setMatch(d); setSearch(false); setMessage('Соперник найден!'); break }
        await new Promise(r => setTimeout(r, 3000));
      } while (Date.now() - start < 65000);
      if (d.status === 'searching') { setMessage('Поиск продолжается.'); }
    } catch (e: any) { setMessage(e.message) }
  }

  async function acceptBot() {
    try {
      const d = await api('/api/match/bot/accept', {});
      setMatch(d); setOffer(false); setSearch(false); setMessage('Бой с тренировочным ботом начался.')
    } catch (e: any) { setMessage(e.message) }
  }

  async function cancel() {
    try { await api('/api/match/cancel', {}); } catch { }
    setSearch(false); setOffer(false); setMessage('Поиск отменён.');
  }

  if (!profile) return (
    <main className="wrap">
      <h1>⚔️ Coin Battle</h1>
      <p>{message}</p>
    </main>
  );

  return (
    <main className="wrap">
      <header>
        <div><h1>⚔️ Coin Battle</h1><small>Арена начинается здесь</small></div>
        <div className="coin">🪙 {profile.coin.toLocaleString('ru-RU')}</div>
      </header>
      
      <section className="panel">
        <h2>{profile.displayName}</h2>
        <div className="stats">
          <div><b>{profile.level}</b><small>Уровень</small></div>
          <div><b>{profile.xp}</b><small>XP</small></div>
          <div><b>{Math.round(profile.power)}</b><small>Сила</small></div>
        </div>
      </section>

      <section className="panel">
        <h2>Характеристики</h2>
        {(['attack', 'defense', 'health'] as const).map((s) => (
          <div className="statrow" key={s}>
            <span>{s === 'attack' ? '⚔️ Атака' : s === 'defense' ? '🛡 Защита' : '❤️ Здоровье'}: <b>{profile.stats[s]}</b></span>
            <button onClick={() => upgrade(s)}>Улучшить · 250+ COIN</button>
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>Арена PvP</h2>
        <p className="muted">Подбор по XP: сначала близкие значения, затем диапазон постепенно расширяется.</p>
        {!search && !match && <button className="primary" onClick={find}>Найти соперника</button>}
        {search && <button onClick={cancel}>Отменить поиск</button>}
        {offer && (
          <div className="offer">
            <b>🤖 Тренировочный бот</b>
            <p>Он примерно на 7% сильнее по боевой силе и использует тактику. Это бот, не реальный игрок. Бой без ставки.</p>
            <button className="primary" onClick={acceptBot}>Согласен, начать бой</button>
            <button onClick={cancel}>Нет, продолжить позже</button>
          </div>
        )}
        {match && (
          <div className="offer">
            <b>{match.opponent?.label === 'БОТ' ? '🤖 Тренировочный бот' : '⚔️ Соперник найден'}</b>
            <p>{match.opponent?.label === 'БОТ' ? 'Бот немного сильнее и выбирает тактику.' : 'Матч создан.'}</p>
            <button onClick={() => setMatch(null)}>Закрыть карточку матча</button>
          </div>
        )}
      </section>

      <p className="status">{message}</p>
      <footer>COIN — внутриигровая валюта · MVP</footer>
    </main>
  );
}
