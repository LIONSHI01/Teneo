def show_points_history():
    if os.path.exists("points_log.txt"):
        with open("points_log.txt", "r") as f:
            print(f"{green}积分历史记录: {reset}")
            print(f.read())
    else:
        print(f"{yellow}未找到积分历史记录文件！")

async def connect(self, userid):
    max_retry = 10  # 最大重试次数
    retry = 1
    self.ses = aiohttp.ClientSession()
    show_points_history()  # 显示积分历史
    while True:
        try:
            if retry >= max_retry:
                self.log(f"{yellow}达到最大重试次数，请稍后再试 1")
                return
            async with self.ses.ws_connect(
                url=f"{self.wss_url}?userId={userid}&version=v0.2",
                proxy=self.proxy  # 使用代理
            ) as wss:
                retry = 1
                self.log(f"{green}连接到 {white}WebSocket {green}服务器")
                while True:
                    msg = await wss.receive_json(timeout=10)
                    point_today = msg.get("pointsToday")
                    point_total = msg.get("pointsTotal")
                    self.log(
                        f"{green}今天的积分 : {white}{point_today} {magenta}| {green}总积分 : {white}{point_total}"
                    )

                    for i in range(90):
                        await wss.send_json({"type": "PING"})
                        self.log(f"{white}发送 {green}PING {white}到服务器！")
                        await countdown(10)
        except KeyboardInterrupt:
            await self.ses.close()
        except Exception as e:
            self.log(f"{red}错误 : {white}{e}")
            retry += 1
            continue
