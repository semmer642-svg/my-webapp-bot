import "dotenv/config";
import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { verifyTelegramInitData } from "./telegram";
import { botStats, chooseBotTactic, resolveTurn, combatPower, Stats, Tactic } from "./game";

const app = express();
const prisma = new PrismaClient();

// ОБНОВЛЕННЫЙ CORS: разрешаем все нужные заголовки для Telegram WebView
app.use(cors({
  origin: process.env.WEBAPP_URL || "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-telegram-init-data", "Accept", "Authorization"],
  credentials: true
}));

app.use(express.json());

async function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const raw = String(req.header("x-telegram-init-data") || "");
    const data = verifyTelegramInitData(raw, process.env.BOT_TOKEN || "");
    const tgUser = JSON.parse(data.user || "{}");
    if (!tgUser.id) throw new Error("Telegram user missing");
    const displayName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || "Игрок";
    const player = await prisma.player.upsert({
      where: { telegramId: String(tgUser.id) },
      update: { username: tgUser.username, displayName },
      create: { telegramId: String(tgUser.id), username: tgUser.username, displayName }
    });
    (req as any).player = player;
    next();
  } catch (e:any) { res.status(401).json({ error: e.message || "Unauthorized" }); }
}

app.get("/api/health", (_req,res) => res.json({ok:true}));

app.get("/api/me", auth, (req,res) => {
  const p = (req as any).player;
  res.json({id:p.id, displayName:p.displayName, coin:p.coin, xp:p.xp, level:p.level,
    stats:{attack:p.attack, defense:p.defense, health:p.health},
    power:combatPower(p)});
});

app.post("/api/upgrade", auth, async (req,res) => {
  const schema = z.object({stat:z.enum(["attack","defense","health"])});
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({error:"Некорректная характеристика"});
  const p = (req as any).player;
  const cost = 250 + p.level * 50;
  if (p.coin < cost) return res.status(400).json({error:"Недостаточно COIN"});
  const updated = await prisma.player.update({where:{id:p.id},data:{
    coin:{decrement:cost}, xp:{increment:25}, level:{increment:0},
    [parsed.data.stat]:{increment:1}
  }});
  res.json({ok:true, coin:updated.coin, xp:updated.xp, stats:{attack:updated.attack,defense:updated.defense,health:updated.health}});
});

// MVP queue: in-memory, suitable only for one server instance and closed testing.
const queue: Array<{playerId:string; xp:number; joinedAt:number}> = [];
const waitingBotOffers = new Map<string, number>();

app.post("/api/match/queue", auth, async (req,res) => {
  const p = (req as any).player;
  const now = Date.now();
  const existing = queue.findIndex(x => x.playerId === p.id);
  if (existing < 0) queue.push({playerId:p.id,xp:p.xp,joinedAt:now});
  const me = queue.find(x => x.playerId === p.id)!;
  const elapsed = Math.floor((now-me.joinedAt)/1000);
  const range = elapsed < 15 ? 100 : elapsed < 30 ? 250 : elapsed < 45 ? 500 : 1000;
  const rivalIndex = queue.findIndex(x => x.playerId !== p.id && Math.abs(x.xp-p.xp) <= range);
  if (rivalIndex >= 0) {
    const rival = queue.splice(rivalIndex,1)[0];
    const mine = queue.findIndex(x => x.playerId === p.id);
    if (mine >= 0) queue.splice(mine,1);
    const match = await prisma.match.create({data:{playerId:p.id,opponentType:"player",status:"matched",stake:0}});
    return res.json({status:"matched",matchId:match.id,opponent:"Игрок",range});
  }
  if (elapsed >= 60) {
    waitingBotOffers.set(p.id,now);
    return res.json({status:"bot_offer",message:"Рядом нет подходящего игрока. Сразиться с ботом?",botPowerBonus:"около 7%"});
  }
  res.json({status:"searching",elapsed,range});
});

app.post("/api/match/cancel", auth, (req,res) => {
  const p = (req as any).player;
  const i = queue.findIndex(x => x.playerId === p.id);
  if (i >= 0) queue.splice(i,1);
  waitingBotOffers.delete(p.id);
  res.json({ok:true});
});

app.post("/api/match/bot/accept", auth, async (req,res) => {
  const p = (req as any).player;
  if (!waitingBotOffers.has(p.id)) return res.status(400).json({error:"Предложение боя с ботом не найдено"});
  waitingBotOffers.delete(p.id);
  const queued = queue.findIndex(x => x.playerId === p.id);
  if (queued >= 0) queue.splice(queued, 1);
  const bot = botStats(p as Stats);
  const match = await prisma.match.create({data:{playerId:p.id,opponentType:"bot",status:"active",stake:0}});
  res.json({status:"active",matchId:match.id,opponent:{name:"Тренировочный бот",label:"БОТ",stats:bot},playerStats:{attack:p.attack,defense:p.defense,health:p.health}});
});

app.post("/api/match/bot/turn", auth, async (req,res) => {
  const p = (req as any).player;
  const schema = z.object({matchId:z.string(), tactic:z.enum(["aggressive","guard","recover","balanced"])});
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({error:"Некорректный ход"});
  const match = await prisma.match.findFirst({where:{id:parsed.data.matchId,playerId:p.id,opponentType:"bot",status:"active"}});
  if (!match) return res.status(404).json({error:"Матч не найден"});
  const bot = botStats(p as Stats);
  const playerTactic:Tactic = parsed.data.tactic;
  const botTactic = chooseBotTactic(p.health,p.health,1);
  const damageToBot = resolveTurn(p as Stats,bot,playerTactic);
  const damageToPlayer = resolveTurn(bot,p as Stats,botTactic);
  const log = {playerTactic,botTactic,damageToBot,damageToPlayer,botPower:combatPower(bot)};
  // This route is a combat-rule prototype. Persist full HP/round state before public release.
  res.json({ok:true,log,note:"Для полноценного боя нужно хранить HP и номер раунда на сервере."});
});

app.listen(Number(process.env.PORT || 3001), () => console.log("Coin Battle API listening"));

// === ПРОСТОЙ БОТ ДЛЯ TELEGRAM ===
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;

console.log("DEBUG: BOT_TOKEN exists?", !!BOT_TOKEN);

if (BOT_TOKEN) {
  let offset = 0;
  
  const sendMessage = async (chatId: number, text: string, replyMarkup?: any) => {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, reply_markup: replyMarkup })
    });
  };

  const poll = async () => {
    try {
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=30`);
      const data = await res.json();
      
      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          
          if (update.message && update.message.text === "/start") {
            const chatId = update.message.chat.id;
            const keyboard = WEBAPP_URL ? {
              inline_keyboard: [[
                { text: "🎮 Играть в Coin Battle", web_app: { url: WEBAPP_URL } }
              ]]
            } : undefined;
            
            await sendMessage(chatId, "Добро пожаловать в Coin Battle! Нажмите кнопку ниже, чтобы начать.", keyboard);
          }
        }
      }
    } catch (e) {
      console.error("Bot polling error:", e);
    }
    setTimeout(poll, 1000);
  };

  poll();
  console.log("Telegram Bot polling started!");
}
