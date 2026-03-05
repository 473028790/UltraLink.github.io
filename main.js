// main.js - 网页主控逻辑

// 🟢 全局调试开关，默认关闭。关闭时完全不触碰 DOM，也不进行 hex 转换
let enableWebUSBDebug = false;
// 🟢 记录当前解析的媒体 URL，用于垃圾回收防泄露
let currentMediaUrl = null;

// ==========================================
// 通用延时函数 (核心流控利器)
// ==========================================
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getLogTime() {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
}

// 往 WebUSB 调试界面的发送框(TX)写入日志
function logWebUSBTx(hexStr) {
  if (!enableWebUSBDebug) return;
  const el = document.getElementById('webusb-tx-log');
  if (!el) return;
  el.value += `[${getLogTime()}] ${hexStr}\n`;
  if (el.value.length > 5000) el.value = el.value.slice(-5000);
  el.scrollTop = el.scrollHeight;
}

// 往 WebUSB 调试界面的接收框(RX)写入日志
function logWebUSBRx(hexStr) {
  if (!enableWebUSBDebug) return;
  const el = document.getElementById('webusb-rx-log');
  if (!el) return;
  el.value += `[${getLogTime()}] ${hexStr}\n`;
  if (el.value.length > 5000) el.value = el.value.slice(-5000);
  el.scrollTop = el.scrollHeight;
}

function clearWebUSBLogs() {
  const tx = document.getElementById('webusb-tx-log');
  const rx = document.getElementById('webusb-rx-log');
  if (tx) tx.value = '';
  if (rx) rx.value = '';
}

// ==========================================
// 1. 建立与后台 Web Worker 的连接并处理数据
// ==========================================
let usbWorker = null;
try {
  usbWorker = new Worker('usb-worker.js');

  usbWorker.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === 'STATUS') {
      if (msg.data === 'CONNECTED') {
        document.getElementById('usb-status').innerText = '🟢 硬件已连接';
        document.getElementById('usb-status').style.color = '#00e676';
        document.getElementById('btn-connect').style.display = 'none';
        document.getElementById('btn-disconnect').style.display =
          'inline-block';
        isConnected = true;
      } else if (msg.data === 'DISCONNECTED') {
        document.getElementById('usb-status').innerText = '● 未连接';
        document.getElementById('usb-status').style.color = '#ff5252';
        document.getElementById('btn-connect').style.display = 'inline-block';
        document.getElementById('btn-disconnect').style.display = 'none';
        isConnected = false;
      }
    } else if (msg.type === 'RAW_DATA') {
      if (enableWebUSBDebug) {
        const receivedBuffer = msg.data;
        const hexString = Array.from(receivedBuffer)
          .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
          .join(' ');
        logWebUSBRx(hexString);
      }
    } else if (msg.type === 'ERROR') {
      alert('设备通信错误: ' + msg.data);
    }
  };
} catch (error) {
  console.error('Worker加载失败', error);
}

// ==========================================
// 2. 页面路由与 UI 切换
// ==========================================
function navTo(pageId, title) {
  document
    .querySelectorAll('.page')
    .forEach((el) => el.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
  document.getElementById('page-title').innerText = title;
  document.getElementById('btn-back').style.display = 'inline-block';

  if (pageId === 'page-uart1') setTimeout(resizeChart1, 50);
  if (pageId === 'page-uart2') setTimeout(resizeChart2, 50);
  if (pageId === 'page-pwm') {
    setTimeout(resizeChartPWM, 50);
    updateStaticCharts();
  }
  if (pageId === 'page-dac') {
    setTimeout(resizeChartDAC, 50);
    updateStaticCharts();
  }
  if (pageId === 'page-dap') updateFlashData(0x08000000, null);
}

function goHome() {
  document
    .querySelectorAll('.page')
    .forEach((el) => el.classList.remove('active'));
  document.getElementById('page-home').classList.add('active');
  document.getElementById('page-title').innerText = 'Ultra Link 总控制台';
  document.getElementById('btn-back').style.display = 'none';
}

// ==========================================
// 3. 虚拟 USB 连接逻辑 & 数据发送核心
// ==========================================
let isConnected = false;

async function connectUSB() {
  try {
    if (!navigator.usb) {
      alert('你的浏览器不支持 WebUSB，请使用最新版 Chrome 或 Edge！');
      return;
    }
    await navigator.usb.requestDevice({ filters: [] });
    if (usbWorker) usbWorker.postMessage({ cmd: 'CONNECT' });
  } catch (error) {
    console.error('用户取消或找不到设备', error);
  }
}

function disconnectUSB() {
  if (usbWorker) usbWorker.postMessage({ cmd: 'DISCONNECT' });
}

function sendCMD(cmdType, payload) {
  if (!isConnected) {
    alert('请先连接硬件！');
    return;
  }

  if (enableWebUSBDebug) {
    let hexString = '';
    if (payload instanceof Uint8Array) {
      hexString = Array.from(payload)
        .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');
    } else if (typeof payload === 'string') {
      const encoder = new TextEncoder();
      const view = encoder.encode(payload);
      hexString = Array.from(view)
        .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');
    } else {
      hexString = '[Unsupported Data Format]';
    }
    logWebUSBTx(hexString);
  }

  if (usbWorker) {
    usbWorker.postMessage({
      cmd: 'SEND_DATA',
      cmdType: cmdType,
      payload: payload,
    });
  }
}

function applySerialConfig(portNum) {
  if (!isConnected) alert('请先连接硬件！');
}
function setRxMode(portNum, mode) {
  document.getElementById(`rx-ascii-${portNum}`).classList.remove('active');
  document.getElementById(`rx-hex-${portNum}`).classList.remove('active');
  document.getElementById(`rx-${mode}-${portNum}`).classList.add('active');
}
function clearChart(portNum) {
  console.log(`已清空串口 ${portNum} 的图表数据`);
}

// ==========================================
// 4. 芯片选择与 DAP 逻辑
// ==========================================
const chipDatabase = {
  A1SEMI: {
    'ASM32F300 Series': ['ASM32F300B4DI', 'ASM32F300B4QI'],
    'ASM32F310 Series': ['ASM32F310B4DI'],
  },
  GigaDevice: {
    'GD32F10x Series': ['GD32F103C8T6', 'GD32F103RET6'],
    'GD32F30x Series': ['GD32F303CCT6'],
  },
  STMicroelectronics: {
    'STM32F1 Series': ['STM32F103C8T6'],
    'STM32H7 Series': ['STM32H743VIT6', 'STM32H750VBT6'],
  },
  HPMicro: {
    'HPM6700 Series': ['HPM6750IVK1'],
    'HPM6300 Series': ['HPM6360IVK1'],
  },
};
let currentBrand = '';

function initChipSelector() {
  const brandList = document.getElementById('chip-brand-list');
  brandList.innerHTML = '';
  Object.keys(chipDatabase).forEach((brand) => {
    let li = document.createElement('li');
    li.innerText = brand;
    li.onclick = () => selectBrand(li, brand);
    brandList.appendChild(li);
  });
  if (brandList.firstChild)
    selectBrand(brandList.firstChild, Object.keys(chipDatabase)[0]);
}
function selectBrand(el, brand) {
  document
    .querySelectorAll('#chip-brand-list li')
    .forEach((li) => li.classList.remove('active'));
  el.classList.add('active');
  currentBrand = brand;
  const seriesList = document.getElementById('chip-series-list');
  seriesList.innerHTML = '';
  Object.keys(chipDatabase[brand]).forEach((series) => {
    let li = document.createElement('li');
    li.innerText = series;
    li.onclick = () => selectSeries(li, series);
    seriesList.appendChild(li);
  });
  if (seriesList.firstChild)
    selectSeries(seriesList.firstChild, Object.keys(chipDatabase[brand])[0]);
}
function selectSeries(el, series) {
  document
    .querySelectorAll('#chip-series-list li')
    .forEach((li) => li.classList.remove('active'));
  el.classList.add('active');
  const modelList = document.getElementById('chip-model-list');
  modelList.innerHTML = '';
  chipDatabase[currentBrand][series].forEach((model) => {
    let li = document.createElement('li');
    li.innerText = model;
    li.onclick = () => selectModel(li, model);
    modelList.appendChild(li);
  });
  if (modelList.firstChild)
    selectModel(modelList.firstChild, chipDatabase[currentBrand][series][0]);
}
function selectModel(el, modelName) {
  document
    .querySelectorAll('#chip-model-list li')
    .forEach((li) => li.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('modal-selected-chip').value = modelName;
}
function openChipSelector() {
  document.getElementById('chip-modal').classList.add('active');
}
function closeChipSelector() {
  document.getElementById('chip-modal').classList.remove('active');
}
function confirmChipSelection() {
  document.getElementById('dap-mcu').value = document.getElementById(
    'modal-selected-chip',
  ).value;
  closeChipSelector();
}
function switchDapTab(tabId, el) {
  document
    .querySelectorAll('.dap-main-tab')
    .forEach((item) => item.classList.remove('active'));
  el.classList.add('active');
  document
    .querySelectorAll('.dap-sub-page')
    .forEach((sec) => sec.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
}
function dapAction(actionName) {
  let log = document.getElementById('dap-log');
  let time = new Date().toLocaleTimeString();
  log.value += `\n[${time}] 操作: ${actionName} ...`;
  log.scrollTop = log.scrollHeight;
}
function updateFlashData(startAddr, dataArray) {
  let tbody = document.getElementById('flash-tbody');
  tbody.innerHTML = '';
  for (let r = 0; r < 32; r++) {
    let tr = document.createElement('tr');
    let addrTd = document.createElement('td');
    addrTd.className = 'addr-col';
    addrTd.innerText =
      '0x' + (startAddr + r * 16).toString(16).toUpperCase().padStart(8, '0');
    tr.appendChild(addrTd);
    let asciiStr = '';
    for (let c = 0; c < 16; c++) {
      let td = document.createElement('td');
      td.innerText = 'FF';
      tr.appendChild(td);
      asciiStr += '.';
    }
    let asciiTd = document.createElement('td');
    asciiTd.style.color = '#888';
    asciiTd.style.borderLeft = '2px solid #555';
    asciiTd.innerText = asciiStr;
    tr.appendChild(asciiTd);
    tbody.appendChild(tr);
  }
}

// ==========================================
// 5. PWM 与 DAC 控制逻辑
// ==========================================
let pwmIsOn = false;
function togglePwmUI() {
  const mode = document.getElementById('pwm-mode').value;
  document.getElementById('pwm-volt-high').style.display =
    mode === 'high' ? 'block' : 'none';
  document.getElementById('pwm-volt-low').style.display =
    mode === 'high' ? 'none' : 'block';
  updateStaticCharts();
}
function syncPwmDuty(source) {
  let slider = document.getElementById('pwm-duty-slider');
  let numInput = document.getElementById('pwm-duty-num');
  if (source === 'slider') {
    numInput.value = slider.value;
  } else if (source === 'num') {
    let val = parseInt(numInput.value);
    if (val > 100) val = 100;
    if (val < 0) val = 0;
    numInput.value = val;
    slider.value = val;
  }
  updateStaticCharts();
}
function togglePwmOutput() {
  const btn = document.getElementById('btn-pwm-out');
  pwmIsOn = !pwmIsOn;
  if (pwmIsOn) {
    btn.innerText = '⏹ 停止输出';
    btn.style.background = '#cc3300';
  } else {
    btn.innerText = '▶ 开启输出';
    btn.style.background = '#28a745';
  }
}
function sendPwmConfig() {}
function toggleDacUI() {}
function sendDacConfig() {}

// ==========================================
// 6. 系统设置 页面逻辑
// ==========================================
function switchSysTab(tabId, el) {
  document
    .querySelectorAll('.sys-menu-item')
    .forEach((item) => item.classList.remove('active'));
  el.classList.add('active');
  document
    .querySelectorAll('.sys-section')
    .forEach((sec) => sec.classList.remove('active'));
  document.getElementById('sys-tab-' + tabId).classList.add('active');
}

function updateSysConfig() {
  let sysConfig = { theme: document.getElementById('sys-theme').value };
  if (sysConfig.theme === 'light') {
    document.documentElement.style.setProperty('--bg', '#f0f2f5');
    document.documentElement.style.setProperty('--panel', '#ffffff');
    document.documentElement.style.setProperty('--text', '#333333');
  } else {
    document.documentElement.style.setProperty('--bg', '#1e1e1e');
    document.documentElement.style.setProperty('--panel', '#2d2d2d');
    document.documentElement.style.setProperty('--text', '#eaeaea');
  }

  enableWebUSBDebug = document.getElementById('sys-debug-webusb').checked;
  const webusbCard = document.getElementById('card-webusb');
  if (webusbCard) {
    webusbCard.style.display = enableWebUSBDebug ? 'block' : 'none';
  }
  if (!enableWebUSBDebug) {
    clearWebUSBLogs();
  }
}

// ==========================================
// 7. uPlot 绘图初始化
// ==========================================
let uplot1, uplot2, uplotPWM, uplotDAC;
const STATIC_POINTS = 500;
const TIME_WINDOW_MS = 15;
let staticTimeArray = new Float32Array(STATIC_POINTS);
for (let i = 0; i < STATIC_POINTS; i++) {
  staticTimeArray[i] = (i / (STATIC_POINTS - 1)) * TIME_WINDOW_MS;
}

function tooltipPlugin() {
  let tooltip;
  return {
    hooks: {
      init: (u) => {
        tooltip = document.createElement('div');
        tooltip.className = 'u-tooltip';
        u.root.querySelector('.u-over').appendChild(tooltip);
      },
      setCursor: (u) => {
        const { left, top, idx } = u.cursor;
        if (idx === null || left < 0) {
          tooltip.style.display = 'none';
          return;
        }
        tooltip.style.display = 'block';
        tooltip.style.left =
          (left > u.bbox.width - 120 ? left - 120 : left + 15) + 'px';
        tooltip.style.top = top + 15 + 'px';
        tooltip.innerHTML = `时间: <span style="color:#fff">${u.data[0][idx].toFixed(2)} ms</span><br>电压: <span class="val">${u.data[1][idx].toFixed(3)} V</span>`;
      },
    },
  };
}

window.addEventListener('DOMContentLoaded', () => {
  initChipSelector();
  const getUartOpts = (color, name) => ({
    width: 500,
    height: 200,
    axes: [
      { stroke: '#666', grid: { stroke: '#333', width: 1 } },
      { stroke: '#666', grid: { stroke: '#333', width: 1 } },
    ],
    scales: { x: { time: false }, y: { auto: true } },
    series: [{}, { label: name, stroke: color, width: 2 }],
    cursor: { sync: { key: 'scope' } },
  });

  let chartData = [Array(500).fill(0), Array(500).fill(0)];
  for (let i = 0; i < 500; i++) chartData[0][i] = i;

  uplot1 = new uPlot(
    getUartOpts('#ff9800', 'UART 1'),
    chartData,
    document.getElementById('chart-container-1'),
  );
  uplot2 = new uPlot(
    getUartOpts('#b388ff', 'UART 2'),
    chartData,
    document.getElementById('chart-container-2'),
  );

  const getStaticOpts = (color) => ({
    width: 500,
    height: 120,
    plugins: [tooltipPlugin()],
    legend: { show: false },
    axes: [
      { stroke: '#ccc', grid: { stroke: '#333', width: 1 }, size: 25 },
      { stroke: '#ccc', grid: { stroke: '#333', width: 1 }, size: 30 },
    ],
    scales: { x: { time: false }, y: { auto: false, range: [-0.5, 5.5] } },
    series: [{ label: '时间 (ms)' }, { stroke: color, width: 2 }],
    cursor: { drag: { setScale: false } },
  });

  uplotPWM = new uPlot(
    getStaticOpts('#00e676'),
    [[], []],
    document.getElementById('chart-container-pwm'),
  );
  uplotDAC = new uPlot(
    getStaticOpts('#ffeb3b'),
    [[], []],
    document.getElementById('chart-container-dac'),
  );
});

function resizeChart1() {
  if (uplot1)
    uplot1.setSize({
      width: document.getElementById('chart-container-1').clientWidth,
      height: document.getElementById('chart-container-1').clientHeight,
    });
}
function resizeChart2() {
  if (uplot2)
    uplot2.setSize({
      width: document.getElementById('chart-container-2').clientWidth,
      height: document.getElementById('chart-container-2').clientHeight,
    });
}
function resizeChartPWM() {
  if (uplotPWM)
    uplotPWM.setSize({
      width: document.getElementById('chart-container-pwm').clientWidth,
      height: 120,
    });
}
function resizeChartDAC() {
  if (uplotDAC)
    uplotDAC.setSize({
      width: document.getElementById('chart-container-dac').clientWidth,
      height: 120,
    });
}

window.addEventListener('resize', () => {
  resizeChart1();
  resizeChart2();
  resizeChartPWM();
  resizeChartDAC();
});

function updateStaticCharts() {
  if (!uplotPWM || !uplotDAC) return;
  let modePWM = document.getElementById('pwm-mode').value;
  let vHigh =
    modePWM === 'high'
      ? parseFloat(
          document.querySelector('input[name="pwm-v-fixed"]:checked').value,
        )
      : parseFloat(document.getElementById('pwm-v-custom').value);
  let freqPWM = parseFloat(document.getElementById('pwm-freq').value) || 1000;
  let duty = parseFloat(document.getElementById('pwm-duty-num').value) / 100.0;
  let periodPWM = 1000.0 / freqPWM;

  let pwmArray = new Float32Array(STATIC_POINTS);
  for (let i = 0; i < STATIC_POINTS; i++) {
    let phase = (staticTimeArray[i] % periodPWM) / periodPWM;
    pwmArray[i] = phase <= duty ? vHigh : 0.0;
  }
  uplotPWM.setData([Array.from(staticTimeArray), Array.from(pwmArray)]);
}

// ==========================================
// 8. 暴露所有函数给 HTML
// ==========================================
window.navTo = navTo;
window.goHome = goHome;
window.connectUSB = connectUSB;
window.disconnectUSB = disconnectUSB;
window.sendCMD = sendCMD;
window.applySerialConfig = applySerialConfig;
window.setRxMode = setRxMode;
window.clearChart = clearChart;
window.updateStaticCharts = updateStaticCharts;
window.dapAction = dapAction;
window.switchDapTab = switchDapTab;
window.openChipSelector = openChipSelector;
window.closeChipSelector = closeChipSelector;
window.confirmChipSelection = confirmChipSelection;
window.togglePwmUI = togglePwmUI;
window.syncPwmDuty = syncPwmDuty;
window.togglePwmOutput = togglePwmOutput;
window.sendPwmConfig = sendPwmConfig;
window.toggleDacUI = toggleDacUI;
window.sendDacConfig = sendDacConfig;
window.switchSysTab = switchSysTab;
window.updateSysConfig = updateSysConfig;
window.handleMediaUpload = handleMediaUpload;
window.scrubFrame = scrubFrame;
window.updateCurrentFramePreview = updateCurrentFramePreview;
window.toggleMediaPlay = toggleMediaPlay;
window.clearWebUSBLogs = clearWebUSBLogs;
window.syncFps = syncFps;

// ==========================================
// 9. 图像/视频解析与纯二进制发送逻辑
// ==========================================
let mediaFrames = [];
let currentFrameIdx = 0;
let isPlayingMedia = false;

// 🌟 同步 FPS 滑块与输入框
function syncFps(source) {
  let slider = document.getElementById('fps-slider');
  let numInput = document.getElementById('fps-val');
  if (source === 'slider') {
    numInput.value = slider.value;
  } else if (source === 'num') {
    let val = parseInt(numInput.value);
    if (isNaN(val) || val < 1) val = 1;
    if (val > 60) val = 60; // 限制最高 60帧
    numInput.value = val;
    slider.value = val;
  }
}

async function handleMediaUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById('media-status');

  if (isPlayingMedia) isPlayingMedia = false; // 如果在播放，先停止

  mediaFrames.length = 0;
  mediaFrames = [];
  currentFrameIdx = 0;

  if (currentMediaUrl) {
    URL.revokeObjectURL(currentMediaUrl);
    currentMediaUrl = null;
  }

  const fileName = file.name.toLowerCase();

  if (file.type.startsWith('image/')) {
    statusEl.innerText = '正在解析图片...';
    statusEl.style.color = '#ff9800';
    processImage(file);
  } else if (
    file.type.startsWith('video/') ||
    fileName.match(/\.(avi|mov|mkv|mp4|wmv)$/i)
  ) {
    statusEl.innerText = '🚀 正在上传至服务器进行标准化转码与缩放...';
    statusEl.style.color = '#4fc3f7';
    await uploadAndConvertVideo(file);
  } else {
    alert('不支持的文件格式！');
    statusEl.innerText = '格式错误';
  }
}

async function uploadAndConvertVideo(file) {
  const statusEl = document.getElementById('media-status');
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch('http://139.159.182.20:500/api/convert', {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) throw new Error('服务器拒绝或转码失败');
    const blob = await response.blob();
    const convertedFile = new File([blob], 'standardized_video.mp4', {
      type: 'video/mp4',
    });
    statusEl.innerText = '✅ 服务器转码成功，开始提取帧...';
    processVideo(convertedFile);
  } catch (error) {
    console.error(error);
    statusEl.innerText = '❌ 云端转码失败';
    statusEl.style.color = '#cc3300';
    alert('请求服务器失败！\n' + error.message);
  }
}

function processImage(file) {
  const img = new Image();
  const reader = new FileReader();

  reader.onload = (e) => {
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, 128, 128);
      ctx.drawImage(img, 0, 0, 128, 128);
      mediaFrames = [ctx.getImageData(0, 0, 128, 128)];

      // 🌟 图片模式：隐藏视频进度条和帧率控制
      document.getElementById('video-controls').style.display = 'none';
      document.getElementById('fps-controls').style.display = 'none';

      document.getElementById('media-status').innerText = '图片已加载 (1帧)';
      document.getElementById('media-status').style.color = '#00e676';
      updatePlayButtonUI();
      renderFrameToCanvas(0);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function processVideo(file) {
  const statusEl = document.getElementById('media-status');
  const video = document.createElement('video');
  video.style.opacity = '0.001';
  video.style.position = 'absolute';
  video.style.pointerEvents = 'none';
  video.style.width = '1px';
  video.style.height = '1px';
  document.body.appendChild(video);

  currentMediaUrl = URL.createObjectURL(file);
  video.src = currentMediaUrl;
  video.muted = true;
  video.playsInline = true;

  video.onerror = () => {
    alert('视频解码失败！');
    statusEl.innerText = '解码失败';
    statusEl.style.color = '#cc3300';
    if (document.body.contains(video)) document.body.removeChild(video);
  };

  const FPS = 30;

  video.onloadeddata = () => {
    statusEl.innerText = '正在精确提取画面...';
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const duration = video.duration;
    let extractTime = 0;
    const maxFrames = 8500;

    const extractNextFrame = () => {
      if (extractTime >= duration || mediaFrames.length >= maxFrames) {
        finishVideoProcessing();
        return;
      }
      video.currentTime = extractTime;
    };

    video.onseeked = () => {
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, 128, 128);
      ctx.drawImage(video, 0, 0, 128, 128);
      mediaFrames.push(ctx.getImageData(0, 0, 128, 128));
      statusEl.innerText = `正在提取... 已截取 ${mediaFrames.length} 帧`;
      extractTime += 1 / FPS;
      setTimeout(extractNextFrame, 5);
    };
    extractNextFrame();
  };

  function finishVideoProcessing() {
    if (document.body.contains(video)) {
      video.onerror = null;
      video.src = '';
      document.body.removeChild(video);
    }

    if (mediaFrames.length === 0) return;

    const slider = document.getElementById('frame-slider');
    slider.max = mediaFrames.length - 1;
    slider.value = 0;

    // 🌟 视频模式：显示进度条和帧率控制
    document.getElementById('video-controls').style.display = 'flex';
    document.getElementById('fps-controls').style.display = 'flex';

    document.getElementById('frame-counter').innerText =
      `1 / ${mediaFrames.length}`;
    statusEl.innerText = `提取并转换完成 (${mediaFrames.length}帧)`;
    statusEl.style.color = '#00e676';
    updatePlayButtonUI();
    renderFrameToCanvas(0);
  }
}

function scrubFrame() {
  const slider = document.getElementById('frame-slider');
  currentFrameIdx = parseInt(slider.value);
  document.getElementById('frame-counter').innerText =
    `${currentFrameIdx + 1} / ${mediaFrames.length}`;
  renderFrameToCanvas(currentFrameIdx);
}

function updateCurrentFramePreview() {
  document.getElementById('threshold-val').innerText =
    document.getElementById('threshold-slider').value;
  if (mediaFrames.length > 0)
    renderFrameToCanvas(
      currentFrameIdx < mediaFrames.length ? currentFrameIdx : 0,
    );
}

function renderFrameToCanvas(index) {
  if (!mediaFrames || !mediaFrames[index]) return;
  const canvas = document.getElementById('img-canvas');
  const ctx = canvas.getContext('2d');
  const rawData = mediaFrames[index];
  const threshold = parseInt(document.getElementById('threshold-slider').value);
  const displayData = ctx.createImageData(128, 128);

  for (let i = 0; i < rawData.data.length; i += 4) {
    const r = rawData.data[i],
      g = rawData.data[i + 1],
      b = rawData.data[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const val = gray >= threshold ? 255 : 0;
    displayData.data[i] = val;
    displayData.data[i + 1] = val;
    displayData.data[i + 2] = val;
    displayData.data[i + 3] = 255;
  }
  ctx.putImageData(displayData, 0, 0);
}

function getFrameBinaryData(index) {
  const rawData = mediaFrames[index];
  const threshold = parseInt(document.getElementById('threshold-slider').value);
  const buffer = new Uint8Array(2048);

  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const idx = (y * 128 + x) * 4;
      const gray =
        0.299 * rawData.data[idx] +
        0.587 * rawData.data[idx + 1] +
        0.114 * rawData.data[idx + 2];

      if (gray >= threshold) {
        const destX = 127 - y;
        const destY = x;
        const byteIndex = destY * 16 + Math.floor(destX / 8);
        const bitIndex = 7 - (destX % 8);
        buffer[byteIndex] |= 1 << bitIndex;
      }
    }
  }
  return buffer;
}

function updatePlayButtonUI() {
  const btn = document.getElementById('btn-play-media');
  if (isPlayingMedia) {
    btn.innerText = '⏹ 停止播放并结束发送';
    btn.style.background = '#cc3300';
  } else {
    btn.innerText = `▶ 开始发送流数据 (${mediaFrames.length} 帧)`;
    btn.style.background = '#28a745';
  }
}

// ==========================================
// 🚀 核心修改：真正的“数据流模式”推流逻辑
// ==========================================
let isPushingStream = false; // 推流进程锁，防止疯狂点击按钮导致冲突

async function toggleMediaPlay() {
  if (mediaFrames.length === 0) {
    alert('请先上传解析文件！');
    return;
  }

  if (!isConnected) {
    alert('请先连接硬件！');
    return;
  }

  const isVideo = mediaFrames.length > 1;

  // 1. 如果当前正在播放，用户手动点击了“停止”
  if (isPlayingMedia) {
    isPlayingMedia = false; // 改变标志位，让底下的 while 循环自然退出
    updatePlayButtonUI();

    // 如果是视频，手动停止时才发送 Stop 指令
    if (isVideo) {
      const stopCmd = new Uint8Array([0x80, 0x00, 0x02, 0x01, 0x7e]);
      sendCMD('MEDIA_CTRL', stopCmd);
    }
    return;
  }

  // 2. 防抖保护
  if (isPushingStream) return;

  if (currentFrameIdx >= mediaFrames.length) {
    currentFrameIdx = 0;
  }

  isPlayingMedia = true;
  isPushingStream = true;
  updatePlayButtonUI();

  // 3. 【开始推流前】：只发一次 Start 指令
  const cmdType = isVideo ? 0x02 : 0x01; // 0x02视频，0x01图片
  const startCmd = new Uint8Array([0x80, 0x00, cmdType, 0x00, 0x7e]);
  sendCMD('MEDIA_CTRL', startCmd);

  await sleep(15); // 等待 MCU 清空 rx_offset 和 LCD_GRAM 显存

  // 4. 开始异步推流循环
  while (isPlayingMedia) {
    if (!isConnected) {
      isPlayingMedia = false;
      alert('设备连接已断开，推流自动停止！');
      break;
    }

    const frameBuffer = getFrameBinaryData(currentFrameIdx);

    // 分块发送 2048 字节纯像素数据
    const chunkSize = 512;
    for (let i = 0; i < frameBuffer.length; i += chunkSize) {
      const chunk = frameBuffer.slice(i, i + chunkSize);
      sendCMD('IMG_FRAME', chunk);
    }

    // 🌟 动态计算帧率延时 (计算出每个周期的间隔，控制推流速度)
    let targetFps = parseInt(document.getElementById('fps-val').value);
    if (isNaN(targetFps) || targetFps <= 0) targetFps = 30;

    // 图片固定给15ms防连击，视频则按照目标FPS严格卡住延时
    let delayMs = isVideo ? Math.floor(1000 / targetFps) : 15;
    await sleep(delayMs);

    // 更新网页 UI 进度
    renderFrameToCanvas(currentFrameIdx);
    document.getElementById('frame-slider').value = currentFrameIdx;
    document.getElementById('frame-counter').innerText =
      `${currentFrameIdx + 1} / ${mediaFrames.length}`;

    // 处理循环帧逻辑
    currentFrameIdx++;
    if (currentFrameIdx >= mediaFrames.length) {
      if (!isVideo) {
        // 单张图片发完一帧自然停止
        isPlayingMedia = false;
      } else {
        currentFrameIdx = 0; // 视频循环播放
      }
    }
  }

  // 循环彻底结束，释放进程锁，UI 恢复
  isPushingStream = false;
  updatePlayButtonUI();
}
