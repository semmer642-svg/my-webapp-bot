import { useEffect, useState } from 'react';

declare global { interface Window { Telegram?: any } }

const API_URL = "https://my-webapp-bot-cr76.onrender.com";

type Profile = { id: string; displayName: string; coin: number; xp: number; level: number; stats: { attack: number; defense: number; health: number }; power: number };

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [message, setMessage] = useState('Подключаем профиль…');
  const [search, setSearch] = useState(false);
  const [offer, setOffer] = useState(false);
  const [match, setMatch] = useState<any>(null);

  async function api(path: string, body?: any): Promise<any> {
    const tg = window.Telegram?.WebApp;
    const initData = tg?.initData || '';

    if (!initData) {
      throw new Error("Нет данных от Telegram. Откройте игру через бота.");
    }

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(body ? 'POST' : 'GET', `${API_URL}${path}`, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('x-telegram-init-data', initData);
      xhr.timeout = 60000;

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); } 
          catch (e) { reject(new Error("Ошибка парсинга ответа")); }
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            reject(new Error(err.error || `Ошибка сервера: ${xhr.status}`));
          } catch { reject(new Error(`Ошибка сервера: ${xhr.status}`)); }
        }
      };

      xhr.onerror = () => reject(new Error("Сетевая ошибка (Load failed)"));
      xhr.ontimeout = () => reject(new Error("Сервер просыпается. Подождите."));
      xhr.send(body ? JSON.stringify(body) : null);
    });
  }

  async function load() {
    try {
      const tg = window.Telegram?.WebApp;
      if (tg) { tg.ready(); tg.expand(); }

      let initData = tg?.initData || '';
      let attempts = 0;
      while (!initData && attempts < 15) { 
        await new Promise(r => setTimeout(r, 200));
        initData = window.Telegram?.WebApp?.initData || '';
        attempts++;
      }

      if (!initData) { setMessage('Telegram не передал данные.'); return; }

      const p = await api('/api/me');
      setProfile(p);
      setMessage('Готов к бою!');
    } catch (e: any) { setMessage(e.message || 'Не удалось войти.'); }
  }

  useEffect(() => {
    let isMounted = true;
    const startLoad = () => {
      if (!isMounted) return;
      // Увеличенная задержка для обхода бага iOS 18
      setTimeout(() => { if (isMounted) load(); }, 1000);
    };

    if (document.visibilityState === 'visible') {
      startLoad();
    } else {
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          document.removeEventListener('visibilitychange', handleVisibilityChange);
          setTimeout(startLoad, 500);
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    return () => { isMounted = false; };
  }, []);

  async function upgrade(stat: string) { try { await api('/api/upgrade', { stat }); await load(); } catch (e: any) { setMessage(e.message) } }
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
  async function acceptBot() { try { const d = await api('/api/match/bot/accept', {}); setMatch(d); setOffer(false); setSearch(false); setMessage('Бой начался.'); } catch (e: any) { setMessage(e.message) } }
  async function cancel() { try { await api('/api/match/cancel', {}); } catch { } setSearch(false); setOffer(false); setMessage('Поиск отменён.'); }

  if (!profile) return (<main className="wrap"><h1>⚔️ Coin Battle</h1><p>{message}</p></main>);

  return (
    <main className="wrap">
      <header><div><h1>⚔️ Coin Battle</h1><small>Арена начинается здесь</small></div><div className="coin">🪙 {profile.coin.toLocaleString('ru-RU')}</div></header>
      <section className="panel"><h2>{profile.displayName}</h2><div className="stats"><div><b>{profile.level}</b><small>Уровень</small></div><div><b>{profile.xp}</b><small>XP</small></div><div><b>{Math.round(profile.power)}</b><small>Сила</small></div></div></section>
      <section className="panel"><h2>Характеристики</h2>{(['attack', 'defense', 'health'] as const).map((s) => (<div className="statrow" key={s}><span>{s === 'attack' ? '⚔️ Атака' : s === 'defense' ? '🛡 Защита' : '❤️ Здоровье'}: <b>{profile.stats[s]}</b></span><button onClick={() => upgrade(s)}>Улучшить · 250+ COIN</button></div>))}</section>
      <section className="panel"><h2>Арена PvP</h2><p className="muted">Подбор по XP.</p>{!search && !match && <button className="primary" onClick={find}>Найти соперника</button>}{search && <button onClick={cancel}>Отменить поиск</button>}{offer && (<div className="offer"><b>🤖 Тренировочный бот</b><p>Он сильнее на 7%.</p><button className="primary" onClick={acceptBot}>Согласен</button><button onClick={cancel}>Нет</button></div>)}{match && (<div className="offer"><b>Соперник найден</b><p>Матч создан.</p><button onClick={() => setMatch(null)}>Закрыть</button></div>)}</section>
      <p className="status">{message}</p><footer>COIN · MVP</footer>
    </main>
  );
}
