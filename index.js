const axios = require("axios");
const chalk = require("chalk");
const WebSocket = require("ws");
const { HttpsProxyAgent } = require("https-proxy-agent");
const fs = require("fs");
const readline = require("readline");
const keypress = require("keypress");

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
let enableAutoRetry = true;
let currentAccountIndex = 0;
let useBearerTokens = false;

function loadAccounts() {
  if (!fs.existsSync("account.txt")) {
    console.error("未找到 account.txt 文件。请添加账号数据文件。");
    process.exit(1);
  }

  try {
    const data = fs.readFileSync("account.txt", "utf8");
    accounts = data
      .split("\n")
      .map((line) => {
        const [email, password] = line.split(",");
        if (email && password) {
          return { email: email.trim(), password: password.trim() };
        }
        return null;
      })
      .filter((account) => account !== null);
  } catch (err) {
    console.error("加载账号失败:", err);
  }
}

function loadBearerTokens() {
  if (!fs.existsSync("bearer.txt")) {
    console.error("未找到 bearer.txt 文件。请添加 bearer tokens 文件。");
    process.exit(1);
  }

  try {
    const data = fs.readFileSync("bearer.txt", "utf8");
    accessTokens = data
      .split("\n")
      .map((token) => token.trim())
      .filter((token) => token);
    if (accessTokens.length === 0) {
      console.error("在 bearer.txt 中未找到有效的 bearer tokens。");
      process.exit(1);
    }
  } catch (err) {
    console.error("加载 bearer tokens 失败:", err);
  }
}

function loadProxies() {
  if (!fs.existsSync("proxy.txt")) {
    console.error("未找到 proxy.txt 文件。请添加代理数据文件。");
    process.exit(1);
  }

  try {
    const data = fs.readFileSync("proxy.txt", "utf8");
    proxies = data
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line);
  } catch (err) {
    console.error("加载代理失败:", err);
  }
}

function normalizeProxyUrl(proxy) {
  if (!proxy.startsWith("http://") && !proxy.startsWith("https://")) {
    proxy = "http://" + proxy;
  }
  return proxy;
}

function promptUseBearerTokens() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(
      "是否使用 bearer tokens 代替邮箱/密码登录？(y/n): ",
      (answer) => {
        useBearerTokens = answer.toLowerCase() === "y";
        rl.close();
        resolve();
      }
    );
  });
}

function promptUseProxy() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("是否使用代理？(y/n): ", (answer) => {
      useProxy = answer.toLowerCase() === "y";
      rl.close();
      resolve();
    });
  });
}

function promptEnableAutoRetry() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("是否启用账号错误自动重试？(y/n): ", (answer) => {
      enableAutoRetry = answer.toLowerCase() === "y";
      rl.close();
      resolve();
    });
  });
}

async function initialize() {
  displayHeader();
  await promptUseBearerTokens();
  if (useBearerTokens) {
    loadBearerTokens();
  } else {
    loadAccounts();
  }
  loadProxies();
  // await promptUseProxy();
  // await promptEnableAutoRetry();

  if (
    useProxy &&
    proxies.length < (useBearerTokens ? accessTokens.length : accounts.length)
  ) {
    console.error("代理数量不足，请添加更多代理。");
    process.exit(1);
  }

  const length = useBearerTokens ? accessTokens.length : accounts.length;
  for (let i = 0; i < length; i++) {
    potentialPoints[i] = 0;
    countdowns[i] = "计算中...";
    pointsTotals[i] = 0;
    pointsToday[i] = 0;
    lastUpdateds[i] = null;
    messages[i] = "";
    userIds[i] = null;
    browserIds[i] = null;
    if (!useBearerTokens) {
      accessTokens[i] = null;
      getUserId(i);
    } else {
      connectWebSocket(i);
    }
  }

  displayAccountData(currentAccountIndex);
  // handleUserInput();
}

function generateBrowserId(index) {
  return `browserId-${index}-${Math.random().toString(36).substring(2, 15)}`;
}

function displayHeader() {
  console.log("");
  console.log(
    chalk.cyan("按 'A' 切换到上一个账号，'D' 切换到下一个账号，'C' 退出程序。")
  );
  console.log("");
}

function displayAccountData(index) {
  console.clear();
  displayHeader();

  const width = process.stdout.columns;
  const separatorLine = "_".repeat(width);
  const accountHeader = `账号 ${index + 1}`;
  const padding = Math.max(0, Math.floor((width - accountHeader.length) / 2));

  console.log(chalk.cyan(separatorLine));
  console.log(chalk.cyan(" ".repeat(padding) + chalk.bold(accountHeader)));
  console.log(chalk.cyan(separatorLine));

  if (!useBearerTokens) {
    console.log(chalk.whiteBright(`邮箱: ${accounts[index].email}`));
    console.log(`用户 ID: ${userIds[index]}`);
    console.log(`浏览器 ID: ${browserIds[index]}`);
  }
  console.log(chalk.green(`总积分: ${pointsTotals[index]}`));
  console.log(chalk.green(`今日积分: ${pointsToday[index]}`));
  console.log(chalk.whiteBright(`消息: ${messages[index]}`));

  const proxy = proxies[index % proxies.length];
  if (useProxy && proxy) {
    console.log(chalk.hex("#FFA500")(`代理: ${proxy}`));
  } else {
    console.log(chalk.hex("#FFA500")(`代理: 未使用代理`));
  }

  console.log(chalk.cyan(separatorLine));
  console.log("\n状态:");

  if (messages[index].startsWith("Error:")) {
    console.log(chalk.red(`账号 ${index + 1}: ${messages[index]}`));
  } else {
    console.log(
      `账号 ${index + 1}: 潜在积分: ${potentialPoints[index]}, 倒计时: ${
        countdowns[index]
      }`
    );
  }
}

function handleUserInput() {
  keypress(process.stdin);

  process.stdin.on("keypress", (ch, key) => {
    if (key && key.name === "a") {
      currentAccountIndex =
        (currentAccountIndex -
          1 +
          (useBearerTokens ? accessTokens.length : accounts.length)) %
        (useBearerTokens ? accessTokens.length : accounts.length);
      console.log(`切换到账号: ${currentAccountIndex + 1}`);
      displayAccountData(currentAccountIndex);
    } else if (key && key.name === "d") {
      currentAccountIndex =
        (currentAccountIndex + 1) %
        (useBearerTokens ? accessTokens.length : accounts.length);
      console.log(`切换到账号: ${currentAccountIndex + 1}`);
      displayAccountData(currentAccountIndex);
    } else if (key && key.name === "c") {
      console.log("正在退出程序...");
      process.exit();
    }
    if (key && key.ctrl && key.name === "c") {
      process.stdin.pause();
    }
  });

  process.stdin.setRawMode(true);
  process.stdin.resume();
}

async function connectWebSocket(index) {
  if (sockets[index]) return;
  const version = "v0.2";
  const url = "wss://secure.ws.teneo.pro";
  const wsUrl = `${url}/websocket?accessToken=${encodeURIComponent(
    accessTokens[index]
  )}&version=${encodeURIComponent(version)}`;

  const proxy = proxies[index % proxies.length];
  const agent =
    useProxy && proxy ? new HttpsProxyAgent(normalizeProxyUrl(proxy)) : null;

  sockets[index] = new WebSocket(wsUrl, { agent });

  sockets[index].onopen = async () => {
    lastUpdateds[index] = new Date().toISOString();
    console.log(`账号 ${index + 1} 已连接`, lastUpdateds[index]);
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
      console.log(`收到服务器心跳信号 - 账号 ${index + 1}。开始 ping...`);
      setTimeout(() => {
        startPinging(index);
      }, 10000);
    }
  };

  sockets[index].onclose = () => {
    console.log(`账号 ${index + 1} 已断开连接`);
    reconnectWebSocket(index);
  };

  sockets[index].onerror = (error) => {
    console.error(`WebSocket 错误 - 账号 ${index + 1}:`, error);
  };
}

async function getUserId(index) {
  const loginUrl = "https://auth.teneo.pro/api/login";

  const proxy = proxies[index % proxies.length];
  const agent =
    useProxy && proxy ? new HttpsProxyAgent(normalizeProxyUrl(proxy)) : null;

  try {
    const response = await axios.post(
      loginUrl,
      {
        email: accounts[index].email,
        password: accounts[index].password,
      },
      {
        httpsAgent: agent,
        headers: {
          Authorization: `Bearer ${accessTokens[index]}`,
          "Content-Type": "application/json",
          authority: "auth.teneo.pro",
          "x-api-key": "OwAG3kib1ivOJG4Y0OCZ8lJETa6ypvsDtGmdhcjB",
          accept: "application/json, text/plain, */*",
          "accept-encoding": "gzip, deflate, br, zstd",
          "accept-language": "en-US,en;q=0.9,id;q=0.8",
          origin: "https://dashboard.teneo.pro",
          referer: "https://dashboard.teneo.pro/",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-site",
          "sec-ch-ua":
            '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
        },
      }
    );

    const { user, access_token } = response.data;
    userIds[index] = user.id;
    accessTokens[index] = access_token;
    browserIds[index] = generateBrowserId(index);
    messages[index] = "连接成功";

    if (index === currentAccountIndex) {
      displayAccountData(index);
    }

    console.log(`账号 ${index + 1} 用户数据:`, user);
    startCountdownAndPoints(index);
    await connectWebSocket(index);
  } catch (error) {
    const errorMessage = error.response
      ? error.response.data.message
      : error.message;
    messages[index] = `错误: ${errorMessage}`;

    if (index === currentAccountIndex) {
      displayAccountData(index);
    }

    console.error(`账号 ${index + 1} 错误:`, errorMessage);

    if (enableAutoRetry) {
      console.log(`3分钟后重试账号 ${index + 1}...`);
      setTimeout(() => getUserId(index), 180000);
    }
  }
}

function startPinging(index) {
  if (pingIntervals[index]) {
    clearInterval(pingIntervals[index]);
  }

  pingIntervals[index] = setInterval(() => {
    if (sockets[index] && sockets[index].readyState === WebSocket.OPEN) {
      sockets[index].send(JSON.stringify({ type: "ping" }));
    }
  }, 30000);
}

function startCountdownAndPoints(index) {
  if (countdownIntervals[index]) {
    clearInterval(countdownIntervals[index]);
  }

  countdownIntervals[index] = setInterval(() => {
    const now = new Date();
    const nextUpdate = new Date(lastUpdateds[index]);
    nextUpdate.setMinutes(nextUpdate.getMinutes() + 30);

    if (now >= nextUpdate) {
      potentialPoints[index] += 1;
      lastUpdateds[index] = now.toISOString();
    }

    const timeLeft = nextUpdate - now;
    const minutes = Math.floor(timeLeft / 60000);
    const seconds = Math.floor((timeLeft % 60000) / 1000);
    countdowns[index] = `${minutes}分${seconds}秒`;

    if (index === currentAccountIndex) {
      displayAccountData(index);
    }
  }, 1000);
}

function reconnectWebSocket(index) {
  if (pingIntervals[index]) {
    clearInterval(pingIntervals[index]);
  }
  if (countdownIntervals[index]) {
    clearInterval(countdownIntervals[index]);
  }

  setTimeout(() => {
    console.log(`尝试重新连接账号 ${index + 1}...`);
    connectWebSocket(index);
  }, 5000);
}

// 启动程序
initialize();
