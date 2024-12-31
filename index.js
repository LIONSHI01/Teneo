const axios = require('axios');
const chalk = require('chalk');
const WebSocket = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');
const readline = require('readline');
const keypress = require('keypress');

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
let accessTokens = [];
let accounts = [];
let useProxy = false;
let currentAccountIndex = 0;

function loadAccounts() {
  if (!fs.existsSync('account.txt')) {
    console.error('account.txt 文件未找到，请添加包含账户数据的文件。');
    process.exit(1);
  }

  try {
    const data = fs.readFileSync('account.txt', 'utf8');
    accounts = data.split('\n').map(line => {
      const [email, password] = line.split(',');
      if (email && password) {
        return { email: email.trim(), password: password.trim() };
      }
      return null;
    }).filter(account => account !== null);
  } catch (err) {
    console.error('加载账户失败:', err);
  }
}

function loadProxies() {
  if (!fs.existsSync('proxy.txt')) {
    console.error('proxy.txt 文件未找到，请添加包含代理数据的文件。');
    process.exit(1);
  }

  try {
    const data = fs.readFileSync('proxy.txt', 'utf8');
    proxies = data.split('\n').map(line => line.trim()).filter(line => line);
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

function promptUseProxy() {
  return new Promise((resolve) => {
    displayHeader();
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('是否使用代理？(y/n): ', (answer) => {
      useProxy = answer.toLowerCase() === 'y';
      rl.close();
      resolve();
    });
  });
}

async function initialize() {
  loadAccounts();
  loadProxies();
  await promptUseProxy();

  if (useProxy && proxies.length < accounts.length) {
    console.error('代理数量不足，请添加更多代理。');
    process.exit(1);
  }

  for (let i = 0; i < accounts.length; i++) {
    potentialPoints[i] = 0;
    countdowns[i] = "正在计算...";
    pointsTotals[i] = 0;
    pointsToday[i] = 0;
    lastUpdateds[i] = null;
    messages[i] = '';
    userIds[i] = null;
    browserIds[i] = null;
    accessTokens[i] = null;
    getUserId(i);
  }

  displayAccountData(currentAccountIndex);
  handleUserInput();
}

function generateBrowserId(index) {
  return `browserId-${index}-${Math.random().toString(36).substring(2, 15)}`;
}

function displayHeader() {
  const width = process.stdout.columns;
  const headerLines = [
    "<|============================================|>",
    "                  Teneo Bot                   ",
    "<|============================================|>"
  ];

  console.log("");
  headerLines.forEach(line => {
    const padding = Math.max(0, Math.floor((width - line.length) / 2));
    console.log(chalk.green(' '.repeat(padding) + line));
  });
  console.log("");
  const instructions = "使用 'A' 切换到上一个账户，'D' 切换到下一个账户，'ctrl+C' 退出程序。";
  const instructionsPadding = Math.max(0, Math.floor((width - instructions.length) / 2));
  console.log(chalk.cyan(' '.repeat(instructionsPadding) + instructions));
}

function displayAccountData(index) {
  console.clear();
  displayHeader();

  const width = process.stdout.columns;
  const separatorLine = '_'.repeat(width);
  const accountHeader = `账户 ${index + 1}`;
  const padding = Math.max(0, Math.floor((width - accountHeader.length) / 2));

  console.log(chalk.cyan(separatorLine));
  console.log(chalk.cyan(' '.repeat(padding) + chalk.bold(accountHeader)));
  console.log(chalk.cyan(separatorLine));

  console.log(chalk.whiteBright(`邮箱: ${accounts[index].email}`));
  console.log(`用户 ID: ${userIds[index]}`);
  console.log(`浏览器 ID: ${browserIds[index]}`);
  console.log(chalk.green(`总积分: ${pointsTotals[index]}`));
  console.log(chalk.green(`今日积分: ${pointsToday[index]}`));
  console.log(chalk.whiteBright(`消息: ${messages[index]}`));

  const proxy = proxies[index % proxies.length];
  if (useProxy && proxy) {
    console.log(chalk.hex('#FFA500')(`代理: ${proxy}`));
  } else {
    console.log(chalk.hex('#FFA500')(`代理: 未使用代理`));
  }

  console.log(chalk.cyan(separatorLine));
  console.log("\n状态:");

  if (messages[index].startsWith("错误:")) {
    console.log(chalk.red(`账户 ${index + 1}: ${messages[index]}`));
  } else {
    console.log(`账户 ${index + 1}: 潜在积分: ${potentialPoints[index]}, 倒计时: ${countdowns[index]}`);
  }
}

function handleUserInput() {
  keypress(process.stdin);

  process.stdin.on('keypress', (ch, key) => {
    if (key && key.name === 'a') {
      currentAccountIndex = (currentAccountIndex - 1 + accounts.length) % accounts.length;
      console.log(`切换到账户索引: ${currentAccountIndex}`);
      displayAccountData(currentAccountIndex);
    } else if (key && key.name === 'd') {
      currentAccountIndex = (currentAccountIndex + 1) % accounts.length;
      console.log(`切换到账户索引: ${currentAccountIndex}`);
      displayAccountData(currentAccountIndex);
    }
  });

  process.stdin.setRawMode(true);
  process.stdin.resume();

  // 监听 ctrl+C 退出程序
  process.on('SIGINT', () => {
    console.log('\n程序已退出');
    process.exit();
  });
}

async function connectWebSocket(index) {
  if (sockets[index]) return;
  const version = "v0.2";
  const url = "wss://secure.ws.teneo.pro";
  const wsUrl = `${url}/websocket?accessToken=${encodeURIComponent(accessTokens[index])}&version=${encodeURIComponent(version)}`;

  const proxy = proxies[index % proxies.length];
  const agent = useProxy && proxy ? new HttpsProxyAgent(normalizeProxyUrl(proxy)) : null;

  sockets[index] = new WebSocket(wsUrl, { agent });

  sockets[index].onopen = async () => {
    lastUpdateds[index] = new Date().toISOString();
    console.log(`账户 ${index + 1} 已连接`, lastUpdateds[index]);
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

      if (index === currentAccountIndex) {
        displayAccountData(index);
      }
    }

    if (data.message === "Pulse from server") {
      console.log(`从服务器接收到心跳，账户 ${index + 1} 开始ping...`);
      setTimeout(() => {
        startPinging(index);
      }, 10000);
    }
  };

  sockets[index].onclose = () => {
    console.log(`账户 ${index + 1} 已断开`);
    reconnectWebSocket(index);
  };

  sockets[index].onerror = (error) => {
    console.error(`WebSocket 账户 ${index + 1} 错误:`, error);
  };
}

async function reconnectWebSocket(index) {
  const version = "v0.2";
  const url = "wss://secure.ws.teneo.pro";
  const wsUrl = `${url}/websocket?accessToken=${encodeURIComponent(accessTokens[index])}&version=${encodeURIComponent(version)}`;

  const proxy = proxies[index % proxies.length];
  const agent = useProxy && proxy ? new HttpsProxyAgent(normalizeProxyUrl(proxy)) : null;

  if (sockets[index]) {
    sockets[index].removeAllListeners();
  }

  sockets[index] = new WebSocket(wsUrl, { agent });

  sockets[index].onopen = async () => {
    lastUpdateds[index] = new Date().toISOString();
    console.log(`账户 ${index + 1} 已重新连接`, lastUpdateds[index]);
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

      if (index === currentAccountIndex) {
        displayAccountData(index);
      }
    }

    if (data.message === "Pulse from server") {
      console.log(`从服务器接收到心跳，账户 ${index + 1} 开始ping...`);
      setTimeout(() => {
        startPinging(index);
      }, 10000);
    }
  };

  sockets[index].onclose = () => {
    console.log(`账户 ${index + 1} 再次断开`);
    setTimeout(() => {
      reconnectWebSocket(index);
    }, 5000);
  };

  sockets[index].onerror = (error) => {
    console.error(`WebSocket 账户 ${index + 1} 错误:`, error);
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

  if (countdowns[index] === "正在计算...") {
    const lastCalculatingTime = lastUpdateds[index].calculatingTime || now;
    const calculatingDuration = now.getTime() - lastCalculatingTime.getTime();

    if (calculatingDuration > restartThreshold) {
      reconnectWebSocket(index);
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
      countdowns[index] = "正在计算，可能需要一段时间才会开始...";
      potentialPoints[index] = 25;

      lastUpdateds[index].calculatingTime = now;
    }
  } else {
    countdowns[index] = "正在计算，可能需要一段时间才会开始...";
    potentialPoints[index] = 0;

    lastUpdateds[index].calculatingTime = now;
  }

  if (index === currentAccountIndex) {
    displayAccountData(index);
  }
}

function startPinging(index) {
  pingIntervals[index] = setInterval(async () => {
    if (sockets[index] && sockets[index].readyState === WebSocket.OPEN) {
      const proxy = proxies[index % proxies.length];
      const agent = useProxy && proxy ? new HttpsProxyAgent(normalizeProxyUrl(proxy)) : null;

      sockets[index].send(JSON.stringify({ type: "PING" }), { agent });
      if (index === currentAccountIndex) {
        displayAccountData(index);
      }
    }
  }, 60000);
}

function stopPinging(index) {
  if (pingIntervals[index]) {
    clearInterval(pingIntervals[index]);
    pingIntervals[index] = null;
  }
}

function restartAccountProcess(index) {
  disconnectWebSocket(index);
  connectWebSocket(index);
  console.log(`WebSocket 重启完成，索引: ${index}`);
}

async function getUserId(index) {
  const loginUrl = "https://auth.teneo.pro/api/login";

  const proxy = proxies[index % proxies.length];
  const agent = useProxy && proxy ? new HttpsProxyAgent(normalizeProxyUrl(proxy)) : null;

  try {
    const response = await axios.post(loginUrl, {
      email: accounts[index].email,
      password: accounts[index].password
    }, {
      httpsAgent: agent,
      headers: {
        'Authorization': `Bearer ${accessTokens[index]}`,
        'Content-Type': 'application/json',
        'authority': 'auth.teneo.pro',
        'x-api-key': 'OwAG3kib1ivOJG4Y0OCZ8lJETa6ypvsDtGmdhcjA'
      }
    });

    const { user, access_token } = response.data;
    userIds[index] = user.id;
    accessTokens[index] = access_token;
    browserIds[index] = generateBrowserId(index);
    messages[index] = "连接成功";

    if (index === currentAccountIndex) {
      displayAccountData(index);
    }

    console.log(`账户 ${index + 1} 的用户数据:`, user);
    startCountdownAndPoints(index);
    await connectWebSocket(index);
  } catch (error) {
    const errorMessage = error.response ? error.response.data.message : error.message;
    messages[index] = `错误: ${errorMessage}`;

    if (index === currentAccountIndex) {
      displayAccountData(index);
    }

    console.error(`账户 ${index + 1} 错误:`, errorMessage);
  }
}

initialize();
