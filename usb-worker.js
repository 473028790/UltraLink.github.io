// usb-worker.js
// 这是一个独立的后台线程，负责所有的 USB 读写操作，防止主界面卡顿

let usbDevice = null;
const IN_EP = 1;
const OUT_EP = 1;

// 监听主线程发来的指令
self.onmessage = async (event) => {
    const msg = event.data;

    if (msg.cmd === 'CONNECT') {
        try {
            // 在 Web Worker 中获取主线程已经授权的设备
            const devices = await navigator.usb.getDevices();
            if (devices.length === 0) {
                self.postMessage({ type: 'ERROR', data: '未找到已授权的设备' });
                return;
            }
            usbDevice = devices[0];
            await usbDevice.open();
            await usbDevice.selectConfiguration(1);
            await usbDevice.claimInterface(0);

            self.postMessage({ type: 'STATUS', data: 'CONNECTED' });
            
            // 启动底层高速接收循环
            startReadLoop();
        } catch (error) {
            self.postMessage({ type: 'ERROR', data: error.message });
        }
    } 
    else if (msg.cmd === 'DISCONNECT') {
        if (usbDevice) {
            await usbDevice.close();
            usbDevice = null;
            self.postMessage({ type: 'STATUS', data: 'DISCONNECTED' });
        }
    }
    else if (msg.cmd === 'SEND_DATA') {
        // 主线程要求发送数据
        if (usbDevice && usbDevice.opened) {
            try {
                await usbDevice.transferOut(OUT_EP, msg.payload);
            } catch (e) {
                console.error("Worker 发送失败", e);
            }
        }
    }
};

// 后台高速轮询接收数据
async function startReadLoop() {
    // 准备一个数组用于波形“攒点” (节流优化)
    let waveBuffer = [];
    let lastSendTime = Date.now();

    while (usbDevice && usbDevice.opened) {
        try {
            const result = await usbDevice.transferIn(IN_EP, 64);
            const rawData = new Uint8Array(result.data.buffer);
            const textData = new TextDecoder().decode(rawData);

            // === 协议解析分支 ===
            
            // 1. 如果是串口文本数据 (例如 "U1:Hello")
            if (textData.startsWith("U1:")) {
                self.postMessage({ type: 'UART1_RX', data: textData.substring(3) + "\n" });
            }
            
            // 2. 如果是波形数据 (假设单片机发来格式 "W:2048"，代表ADC采样值)
            else if (textData.startsWith("W:")) {
                let val = parseInt(textData.substring(2));
                if (!isNaN(val)) {
                    waveBuffer.push(val);
                }
                
                // 【核心优化】：每隔 30 毫秒（约 30fps），把攒下来的几百个点一次性发给主界面画图
                // 绝对不能收到一个点就发一次，否则主线程会卡死！
                if (Date.now() - lastSendTime > 30 && waveBuffer.length > 0) {
                    self.postMessage({ type: 'WAVE_DATA', data: waveBuffer });
                    waveBuffer = []; // 清空缓存
                    lastSendTime = Date.now();
                }
            }
            
            // (你可以在这里继续添加对 CAN、I2C 返回值的二进制解析逻辑)

        } catch (error) {
            console.log("Worker 读取中断:", error);
            break;
        }
    }
}