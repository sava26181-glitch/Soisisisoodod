const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

const users = [];
const battles = [];
const clients = new Map();

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: 'Пользователь уже существует' });
  }
  const hashed = await bcrypt.hash(password, 10);
  const user = { id: uuidv4(), username, password: hashed, balance: 100 };
  users.push(user);
  const token = jwt.sign({ id: user.id }, 'secret_key');
  res.json({ token, user: { id: user.id, username, balance: user.balance } });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);
  if (!user) return res.status(400).json({ error: 'Неверный логин' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: 'Неверный пароль' });
  const token = jwt.sign({ id: user.id }, 'secret_key');
  res.json({ token, user: { id: user.id, username, balance: user.balance } });
});

app.post('/api/battles/create', (req, res) => {
  const { caseId, bet, userId } = req.body;
  const user = users.find(u => u.id === userId);
  if (!user || user.balance < bet) {
    return res.status(400).json({ error: 'Недостаточно средств' });
  }
  user.balance -= bet;
  const battle = {
    id: uuidv4(),
    caseId,
    bet,
    players: [{ userId, username: user.username, bet }],
    status: 'waiting',
    winner: null
  };
  battles.push(battle);
  res.json({ battleId: battle.id });
});

wss.on('connection', (ws) => {
  let userId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'auth') {
        const decoded = jwt.verify(data.token, 'secret_key');
        userId = decoded.id;
        clients.set(userId, ws);
        ws.send(JSON.stringify({ type: 'auth_success', userId }));
      }

      if (data.type === 'create_battle') {
        const user = users.find(u => u.id === userId);
        if (!user || user.balance < data.bet) return;
        user.balance -= data.bet;
        const battle = {
          id: uuidv4(),
          caseId: data.caseId,
          bet: data.bet,
          players: [{ userId, username: user.username, bet: data.bet }],
          status: 'waiting',
          winner: null
        };
        battles.push(battle);
        ws.send(JSON.stringify({ type: 'battle_created', battle }));
      }

      if (data.type === 'join_battle') {
        const battle = battles.find(b => b.id === data.battleId);
        if (!battle || battle.status !== 'waiting') return;
        const user = users.find(u => u.id === userId);
        if (!user || user.balance < battle.bet) return;
        user.balance -= battle.bet;
        battle.players.push({ userId, username: user.username, bet: battle.bet });
        battle.players.forEach(p => {
          const client = clients.get(p.userId);
          if (client) {
            client.send(JSON.stringify({ type: 'battle_update', battle }));
          }
        });
      }
    } catch (e) {
      console.error('Ошибка в WebSocket:', e);
    }
  });

  ws.on('close', () => {
    if (userId) clients.delete(userId);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));