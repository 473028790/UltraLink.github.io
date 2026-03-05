// usb-worker.js - 独立线程处理 USB / 数据流

let usbDevice = null;
let epOut = null;
let epIn = null;
let isConnected = false;
let readLoopRunning = false;

self.onmessage = async function (event) {
  const msg = event.data;

  switch (msg.cmd) {
    case 'CONNECT':
      try {
        // 1. 获取主线程已经授权的 USB 设备
        const devices = await navigator.usb.getDevices();
        if (devices.length === 0) {
          self.postMessage({
            type: 'ERROR',
            data: '未找到已授权的 USB 设备，请在主页面重新连接。',
          });
          return;
        }

        usbDevice = devices[0];
        await usbDevice.open();

        // 2. 选择配置
        if (usbDevice.configuration === null) {
          await usbDevice.selectConfiguration(1);
        }

        // 3. 动态寻找 WebUSB 接口 (Class 255 且不是 Interface 0)
        let targetIntfNum = -1;
        let targetAlt = null;

        for (const intf of usbDevice.configuration.interfaces) {
          const alt = intf.alternate;
          if (alt.interfaceClass === 255 && intf.interfaceNumber !== 0) {
            targetIntfNum = intf.interfaceNumber;
            targetAlt = alt;
          }
        }

        if (targetIntfNum === -1) {
          self.postMessage({
            type: 'ERROR',
            data: `在设备中找不到 WebUSB 接口！`,
          });
          return;
        }

        // 4. 认领接口
        await usbDevice.claimInterface(targetIntfNum);

        // 5. 寻找端点
        epOut = targetAlt.endpoints.find((e) => e.direction === 'out');
        epIn = targetAlt.endpoints.find((e) => e.direction === 'in');

        if (!epOut || !epIn) {
          self.postMessage({
            type: 'ERROR',
            data: `找到接口 ${targetIntfNum}，但找不到端点！`,
          });
          return;
        }

        isConnected = true;
        self.postMessage({ type: 'STATUS', data: 'CONNECTED' });

        // 6. 启动后台持续接收线程
        if (!readLoopRunning) {
          readLoopRunning = true;
          startReadLoop();
        }
      } catch (err) {
        self.postMessage({
          type: 'ERROR',
          data: 'WebUSB 握手失败: ' + err.message,
        });
      }
      break;

    case 'DISCONNECT':
      if (usbDevice && usbDevice.opened) {
        usbDevice.close();
      }
      isConnected = false;
      readLoopRunning = false;
      usbDevice = null;
      self.postMessage({ type: 'STATUS', data: 'DISCONNECTED' });
      break;

    // 核心修改：统一处理前端发来的二进制数据 (Uint8Array)
    case 'SEND_DATA':
      if (!isConnected || !usbDevice) return;
      try {
        // 直接将主线程传来的 Uint8Array 发送给单片机
        await usbDevice.transferOut(epOut.endpointNumber, msg.payload);

        // 如果想看发送了多少字节，可以取消注释下面这行：
        // console.log(`[Worker] 发送了 ${msg.payload.byteLength} 字节`);
      } catch (e) {
        self.postMessage({ type: 'ERROR', data: '数据发送失败: ' + e.message });
      }
      break;
  }
};

// 持续监听 STM32 发回的数据
async function startReadLoop() {
  while (isConnected && usbDevice && usbDevice.opened) {
    try {
      // 阻塞监听 IN 端点的数据，最大接收长度 512 字节
      const result = await usbDevice.transferIn(epIn.endpointNumber, 512);

      if (result.data && result.data.byteLength > 0) {
        // 【核心修改】：不转字符串！直接提取纯二进制数组 (Uint8Array)
        const rawBuffer = new Uint8Array(
          result.data.buffer,
          result.data.byteOffset,
          result.data.byteLength,
        );

        // 向上级(main.js)汇报收到了原始十六进制数据
        self.postMessage({
          type: 'RAW_DATA',
          data: rawBuffer,
        });
      }
    } catch (err) {
      console.log('[Worker] USB 读取结束或连接已断开');
      break;
    }
  }
  readLoopRunning = false;
}
