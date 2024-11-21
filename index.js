const axios = require('axios');
const chalk = require('chalk');
const WebSocket = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');
const readline = require('readline');
const fs = require('fs');
const accounts = require('./account.js');
const { useProxy } = require('./config.js');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let sockets = [];
let pingIntervals = [];
let countdownIntervals = [];
let potentialPoints = [];
let countdowns = [];
let pointsTotals = [];
let pointsToday = [];
let lastUpdateds = [];
let messages = [];
let userIds = [];
let browserIds = [];
let proxies = [];

function loadProxies() {
  try {
    const data = fs.readFileSync('proxy.txt', 'utf8');
    proxies = data.split('\n').map(line => line.trim().replace(/,$/, '').replace(/['"]+/g, '')).filter(line => line);
  } catch (err) {
    console.error('加载代理失败:', err);
  }
}

function normalizeProxyUrl(proxy) {
  if (!proxy.startsWith('http://') && !proxy.startsWith('https://')) {
    proxy = 'http://' + proxy;
  }
  return proxy;
}

const enableLogging = false;

const authorization = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlra25uZ3JneHV4Z2pocGxicGV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjU0MzgxNTAsImV4cCI6MjA0MTAxNDE1MH0.DRAvf8nH1ojnJBc3rD_Nw6t1AV8X_g6gmY_HByG2Mag";
const apikey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlra25uZ3JneHV4Z2pocGxicGV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjU0MzgxNTAsImV4cCI6MjA0MTAxNDE1MH0.DRAvf8nH1ojnJBc3rD_Nw6t1AV8X_g6gmY_HByG2Mag";

function generateBrowserId(index) {
  return `browserId-${index}-${Math.random().toString(36).substring(2, 15)}`;
}

function logToFile(message) {
  if (enableLogging) {
    fs.appendFile('error.log', `${new Date().toISOString()} - ${message}\n`, (err) => {
      if (err) {
        console.error('日志记录失败:', err);
      }
    });
  }
}

function displayHeader() {
  console.log("");
  console.log(chalk.yellow(" ============================================"));
  console.log(chalk.yellow("|                Teneo 机器人               |"));
  console.log(chalk.yellow("|         github.com/sdohuajia              |"));
  console.log(chalk.yellow("|        https://x.com/ferdie_jhovie        |"));
  console.log(chalk.yellow(" ============================================"));
  console.log("");
  console.log(chalk.cyan(`_____________________________________________`));
}

function displayAccountData(index) {
  console.log(chalk.cyan(`================= 账号 ${index + 1} =================`));
  console.log(chalk.whiteBright(`邮箱: ${accounts[index].email}`));
  console.log(`用户ID: ${userIds[index]}`);
  console.log(`浏览器ID: ${browserIds[index]}`);
  console.log(chalk.green(`总积分: ${pointsTotals[index]}`));
  console.log(chalk.green(`今日积分: ${pointsToday[index]}`));
  console.log(chalk.whiteBright(`消息: ${messages[index]}`));
  const proxy = proxies[index % proxies.length];
  if (useProxy && proxy) {
    console.log(chalk.hex('#FFA500')(`代理: ${proxy}`));
  } else {
    console.log(chalk.hex('#FFA500')(`代理: 未使用代理`));
  }
  console.log(chalk.cyan(`_____________________________________________`));
}

function logAllAccounts() {
  console.clear();
  displayHeader();
  for (let i = 0; i < accounts.length; i++) {
    displayAccountData(i);
  }
  console.log("\n状态:");
  for (let i = 0; i < accounts.length; i++) {
    console.log(`账号 ${i + 1}: 潜在积分: ${potentialPoints[i]}, 倒计时: ${countdowns[i]}`);
  }
}

async function connectWebSocket(index) {
  if (sockets[index]) return;
  const version = "v0.2";
  const url = "wss://secure.ws.teneo.pro";
  const wsUrl = `${url}/websocket?userId=${encodeURIComponent(userIds[index])}&version=${encodeURIComponent(version)}&browserId=${encodeURIComponent(browserIds[index])}`;

  const proxy = proxies[index % proxies.length];
  const agent = useProxy && proxy ? new HttpsProxyAgent(normalizeProxyUrl(proxy)) : null;

  sockets[index] = new WebSocket(wsUrl, { agent });

  sockets[index].onopen = async () => {
    lastUpdateds[index] = new Date().toISOString();
    console.log(`账号 ${index + 1} 已连接`, lastUpdateds[index]);
    logToFile(`账号 ${index + 1} 在 ${lastUpdateds[index]} 连接成功`);
    startPinging(index);
    startCountdownAndPoints(index);
  };

  sockets[index].onmessage = async (event) => {
    const data = JSON.parse(event.data);
    if (data.pointsTotal !== undefined && data.pointsToday !== undefined) {
      lastUpdateds[index] = new Date().toISOString();
      pointsTotals[index] = data.pointsTotal;
      pointsToday[index] = data.pointsToday;
      messages[index] = data.message;

      logAllAccounts();
      logToFile(`账号 ${index + 1} 收到数据: ${JSON.stringify(data)}`);
    }

    if (data.message === "Pulse from server") {
      console.log(`账号 ${index + 1} 收到服务器脉冲。开始ping...`);
      logToFile(`账号 ${index + 1} 收到服务器脉冲`);
      setTimeout(() => {
        startPinging(index);
      }, 10000);
    }
  };

  sockets[index].onclose = () => {
    console.log(`账号 ${index + 1} 已断开连接`);
    logToFile(`账号 ${index + 1} 已断开连接`);
    reconnectWebSocket(index);
  };

  sockets[index].onerror = (error) => {
    console.error(`账号 ${index + 1} WebSocket错误:`, error);
    logToFile(`账号 ${index + 1} WebSocket错误: ${error}`);
  };
}

function startCountdownAndPoints(index) {
  clearInterval(countdownIntervals[index]);
  updateCountdownAndPoints(index);
  countdownIntervals[index] = setInterval(() => updateCountdownAndPoints(index), 1000);
}

async function updateCountdownAndPoints(index) {
  const restartThreshold = 60000;
  const now = new Date();

  if (!lastUpdateds[index]) {
    lastUpdateds[index] = {};
  }

  if (countdowns[index] === "计算中...") {
    const lastCalculatingTime = lastUpdateds[index].calculatingTime || now;
    const calculatingDuration = now.getTime() - lastCalculatingTime.getTime();

    if (calculatingDuration > restartThreshold) {
      reconnectWebSocket(index);
      logToFile(`账号 ${index + 1} 由于计算时间过长重新连接`);
      return;
    }
  }

  if (lastUpdateds[index]) {
    const nextHeartbeat = new Date(lastUpdateds[index]);
    nextHeartbeat.setMinutes(nextHeartbeat.getMinutes() + 15);
    const diff = nextHeartbeat.getTime() - now.getTime();

    if (diff > 0) {
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      countdowns[index] = `${minutes}分 ${seconds}秒`;

      const maxPoints = 25;
      const timeElapsed = now.getTime() - new Date(lastUpdateds[index]).getTime();
      const timeElapsedMinutes = timeElapsed / (60 * 1000);
      let newPoints = Math.min(maxPoints, (timeElapsedMinutes / 15) * maxPoints);
      newPoints = parseFloat(newPoints.toFixed(2));

      if (Math.random() < 0.1) {
        const bonus = Math.random() * 2;
        newPoints = Math.min(maxPoints, newPoints + bonus);
        newPoints = parseFloat(newPoints.toFixed(2));
      }

      potentialPoints[index] = newPoints;
    } else {
      countdowns[index] = "计算中，可能需要一分钟才能开始...";
      potentialPoints[index] = 25;

      lastUpdateds[index].calculatingTime = now;
    }
  } else {
    countdowns[index] = "计算中，可能需要一分钟才能开始...";
    potentialPoints[index] = 0;

    lastUpdateds[index].calculatingTime = now;
  }

  logAllAccounts();
  logToFile(`已更新账号 ${index + 1} 的倒计时和积分`);
}

async function getUserId(index) {
  const loginUrl = "https://ikknngrgxuxgjhplbpey.supabase.co/auth/v1/token?grant_type=password";

  const proxy = proxies[index % proxies.length];
  const agent = useProxy && proxy ? new HttpsProxyAgent(normalizeProxyUrl(proxy)) : null;

  try {
    const response = await axios.post(loginUrl, {
      email: accounts[index].email,
      password: accounts[index].password
    }, {
      headers: {
        'Authorization': authorization,
        'apikey': apikey
      },
      httpsAgent: agent
    });

    userIds[index] = response.data.user.id;
    browserIds[index] = generateBrowserId(index);
    logAllAccounts();

    const profileUrl = `https://ikknngrgxuxgjhplbpey.supabase.co/rest/v1/profiles?select=personal_code&id=eq.${userIds[index]}`;
    const profileResponse = await axios.get(profileUrl, {
      headers: {
        'Authorization': authorization,
        'apikey': apikey
      },
      httpsAgent: agent
    });

    console.log(`账号 ${index + 1} 的个人资料:`, profileResponse.data);
    logToFile(`账号 ${index + 1} 的个人资料: ${JSON.stringify(profileResponse.data)}`);
    startCountdownAndPoints(index);
    await connectWebSocket(index);
  } catch (error) {
    console.error(`账号 ${index + 1} 错误:`, error.response ? error.response.data : error.message);
    logToFile(`账号 ${index + 1} 错误: ${error.response ? error.response.data : error.message}`);
  }
}

function startPinging(index) {
  clearInterval(pingIntervals[index]);
  pingIntervals[index] = setInterval(() => {
    if (sockets[index] && sockets[index].readyState === WebSocket.OPEN) {
      sockets[index].send(JSON.stringify({ type: "ping" }));
    }
  }, 30000);
}

function reconnectWebSocket(index) {
  if (sockets[index]) {
    clearInterval(pingIntervals[index]);
    clearInterval(countdownIntervals[index]);
    sockets[index].close();
    sockets[index] = null;
  }
  setTimeout(() => {
    connectWebSocket(index);
  }, 5000);
}

displayHeader();
loadProxies();

for (let i = 0; i < accounts.length; i++) {
  potentialPoints[i] = 0;
  countdowns[i] = "计算中...";
  pointsTotals[i] = 0;
  pointsToday[i] = 0;
  lastUpdateds[i] = null;
  messages[i] = '';
  userIds[i] = null;
  browserIds[i] = null;
  getUserId(i);
}
