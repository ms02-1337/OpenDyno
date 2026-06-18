/**
 * debug-chart.js - Debug page real-time charting
 */

// ========================================
// CHART STATE
// ========================================

let uplot;
let currentDataPoint = [null, null, null, null, null, null];
let motor_speed = 0;
let motor_torque = 0;
let currentMode = "Speed";

// ========================================
// DOM CACHE (for performance optimization)
// ========================================

// getCachedElement is provided by base.js
// Extended update function with decimals parameter for debug page
function updateDOMElement(id, value, decimals = 1) {
  const element = getCachedElement(id);
  if (element) {
    const formattedValue = typeof value === 'number' ? value.toFixed(decimals) : String(value);
    if (element.textContent !== formattedValue) {
      element.textContent = formattedValue;
    }
  }
}

// Chart data storage
let chartData = [
  [], // [0] Time values (milliseconds)
  [], // [1] Setpoint
  [], // [2] Speed
  [], // [3] Torque
  [],  // [4] PWM
  []  // [5] Acceleration
];

// ========================================
// CHART CONFIGURATION
// ========================================

window.MAX_POINTS = 1000;
window.TIME_INTERVAL = 0;
window.MIN_TORQUE = 0;
window.MAX_TORQUE = 1000;
window.MIN_SPEED = 0;
window.MAX_SPEED = 1000;
window.MAX_PWM = 1000;
window.MIN_PWM = 0;
window.MIN_ACC = -1000;
window.MAX_ACC = 1000;

// ========================================
// FORMATTER FUNCTIONS
// ========================================

/**
 * Creates a value formatter with unit suffix
 */
let makeFmt = suffix => (u, v, sidx, didx) => {
  if (didx == null) {
    let d = u.data[sidx];
    v = d[d.length - 1];
  }

  return v == null ? null : v.toFixed(1) + suffix;
};

// ========================================
// CHART MODE CONFIGURATION
// ========================================

/**
 * Get setpoint series configuration based on current mode
 * Setpoint plots on different axes depending on mode:
 * - Torque mode: y1 axis (Torque)
 * - Speed mode: y axis (Speed)
 * - Dynamic mode: y3 axis (Acceleration)
 */
function getSetpointSeriesConfig(mode) {
  switch (mode) {
    case "Torque":
      return {
        label: "Setpoint",
        stroke: "orange",
        width: 2,
        scale: "y1", // Torque axis
        dash: [5, 5],
        value: makeFmt('Nm')
      };
    case "Speed":
      return {
        label: "Setpoint",
        stroke: "orange",
        width: 2,
        scale: "y", // Speed axis
        dash: [5, 5],
        value: makeFmt('rpm')
      };
    case "Dynamic":
      return {
        label: "Setpoint",
        stroke: "orange",
        width: 2,
        scale: "y3", // Acceleration axis
        dash: [5, 5],
        value: makeFmt('RPM/s')
      };
    case "Dynamic debug":
      return {
        label: "Setpoint",
        stroke: "orange",
        width: 2,
        scale: "y3", // Acceleration axis
        dash: [5, 5],
        value: makeFmt('RPM/s')
      };
    default:
      return {
        label: "Setpoint",
        stroke: "orange",
        width: 2,
        scale: "y",
        dash: [5, 5],
        value: makeFmt('rpm')
      };
  }
}

// ========================================
// CHART INITIALIZATION
// ========================================

/**
 * Create and initialize the uPlot chart
 * Configures axes, series, and scales based on current mode
 */
function makeChart() {

  const setpointSeries = getSetpointSeriesConfig(currentMode);
  const opts = {
    width: document.getElementById('chart').clientWidth,
    height: document.getElementById('chart').clientHeight,
    scales: {
      x: {
        time: true, // We're handling time manually
        range: (self, min, max) => [min, max]
      },
      y: { range: [window.MIN_SPEED, window.MAX_SPEED] },  // Speed axis
      y1: { range: [window.MIN_TORQUE, window.MAX_TORQUE] }, // Torque axis
      y2: { range: [window.MIN_PWM, window.MAX_PWM] },        // PWM axis,
      y3: { range: [window.MIN_ACC, window.MAX_ACC] }
    },
    series: [
      {
        label: "Time",
        value: (u, val, sidx, didx) => {
          // For legend (didx is null) or tooltip (didx provided)
          const v = didx == null ? u.data[sidx][u.data[sidx].length - 1] : val;
          if (v == null) return "--";

          const totalMs = v;
          const minutes = Math.floor(totalMs / 60000).toString().padStart(2, '0');
          const remainingMs = totalMs % 60000;
          const seconds = Math.floor(remainingMs / 1000).toString().padStart(2, '0');
          const milliseconds = (remainingMs % 1000).toString().padStart(3, '0');

          return `${minutes}:${seconds}:${milliseconds}`;
        }
      },
      setpointSeries,
      {
        label: "Speed",
        value: makeFmt('rpm'),
        stroke: "red",
        scale: "y",
        width: 1
      },
      {
        label: "Motor Torque (No Inertia)",
        stroke: "blue",
        value: makeFmt('Nm'),
        scale: "y1",
        width: 1
      },
      {
        label: "PWM",
        stroke: "green",
        scale: "y2",
        width: 1,
        value: makeFmt('%')
      },
      {
        label: "Acceleration",
        stroke: "purple",
        scale: "y3",
        width: 1,
        value: makeFmt('RPM/s')
      }
    ],
    axes: [
      {
        label: "Time (s)",
        values: (u, vals) => vals.map(v => {
          const totalSeconds = Math.floor(v / 1000); // Convert ms to seconds
          const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
          const seconds = (totalSeconds % 60).toString().padStart(2, '0');
          return `${minutes}:${seconds}`;
        }),
        scale: "x",
        // Force grid/ticks every second (1000ms)
        grid: {
          show: true,
          stroke: "rgba(0,0,0,0.1)",
          filter: (self, axisIdx, tickValue) => tickValue % 1000 === 0,
        },
        ticks: {
          stroke: "rgba(0,0,0,0.3)",
          width: 1,
          size: 8,
          filter: (self, tickValue) => tickValue % 1000 === 0,
        },
        // Dynamically adjust label density to prevent overlap
        splits: (u, axisIdx, scaleMin, scaleMax) => {
          const rangeMs = scaleMax - scaleMin;
          const visibleSeconds = rangeMs / 1000;
          const step = visibleSeconds > 30 ? 5000 : 1000; // Show fewer labels if zoomed out
          const splits = [];
          for (let t = Math.ceil(scaleMin / step) * step; t <= scaleMax; t += step) {
            splits.push(t);
          }
          return splits;
        },
        // Ensure minimum space per label (adjust based on chart width)
        space: (self, axisIdx, scaleMin, scaleMax, plotDim) => {
          const minPixelsPerSecond = 80; // Minimum space per label (prevents overlap)
          const visibleSeconds = (scaleMax - scaleMin) / 1000;
          return Math.max(minPixelsPerSecond, plotDim / visibleSeconds);
        },
      },
      {
        label: "Speed (rpm)",
        values: (u, vals) => vals.map(v => v.toFixed(0)),
        scale: "y"
      },
      {
        side: 1,
        label: "Motor Torque (Nm)",
        values: (u, vals) => vals.map(v => v.toFixed(0)),
        grid: { show: false },
        scale: "y1"
      },
      {
        label: "PWM (%)",
        values: (u, vals) => vals.map(v => v.toFixed(0)),
        grid: { show: false },
        scale: "y2"
      },
      {
        side: 1,
        label: "Acceleration (RPM/s)",
        values: (u, vals) => vals.map(v => v.toFixed(0)),
        grid: { show: false },
        scale: "y3"
      }
    ],
    cursor: {
      drag: {
        x: true,
        y: false,
      }
    },
    plugins: [
      {
        hooks: {
          init: (u) => {
            let over = u.over;

            over.addEventListener("mousedown", (e) => {
              if (e.button === 1) { // Middle mouse button (scroll button)
                e.preventDefault();

                let left0 = e.clientX;
                let scXMin0 = u.scales.x.min;
                let scXMax0 = u.scales.x.max;

                function onmove(e) {
                  e.preventDefault();

                  let left1 = e.clientX;
                  let dx = left1 - left0;

                  let pxRange = u.bbox.width;
                  let scRange = scXMax0 - scXMin0;

                  let scDx = dx * scRange / pxRange;

                  u.setScale("x", {
                    min: scXMin0 - scDx,
                    max: scXMax0 - scDx,
                  });
                }

                function onup(e) {
                  document.removeEventListener("mousemove", onmove);
                  document.removeEventListener("mouseup", onup);
                }

                document.addEventListener("mousemove", onmove);
                document.addEventListener("mouseup", onup);
              }
            });
          }
        }
      }
    ]
  };




  // Initialize with empty data
  uplot = new uPlot(opts, chartData, document.getElementById('chart'));
  handleResize();
}

// ========================================
// RENDER SCHEDULING (requestAnimationFrame batching)
// ========================================

// Dirty flag + rAF handle: guarantees at most 1 setData() + DOM flush per display frame.
let _chartDirty = false;
let _rafId = null;

// Pending DOM text updates: { elementId: formattedString }
// Collected during Socket.IO handlers, flushed once per frame.
const _pendingDOM = {};

/**
 * Queue a DOM text update to be applied on the next animation frame.
 * @param {string} id   - Element ID
 * @param {*}      value - Value to display
 * @param {number} decimals - Decimal places (for numbers)
 */
function queueDOMUpdate(id, value, decimals = 1) {
  _pendingDOM[id] = typeof value === 'number' ? value.toFixed(decimals) : String(value);
  scheduleRender();
}

/**
 * Mark chart data as changed and schedule a single render on the next frame.
 * Calling this multiple times before the frame fires is a no-op.
 */
function scheduleRender() {
  if (!_chartDirty) {
    _chartDirty = true;
    _rafId = requestAnimationFrame(_renderChart);
  }
}

/**
 * rAF callback: flush queued DOM updates, then render chart — once per frame.
 */
function _renderChart() {
  _chartDirty = false;
  _rafId = null;

  // Flush pending DOM text updates
  for (const id in _pendingDOM) {
    const el = getCachedElement(id);
    if (el && el.textContent !== _pendingDOM[id]) {
      el.textContent = _pendingDOM[id];
    }
    delete _pendingDOM[id];
  }

  // Render chart
  if (chartData[0].length > 0 && uplot) {
    uplot.setData(chartData);
  }
}

// ========================================
// PAUSE/RESUME STATE
// ========================================

let isPaused = false;
let lastTimestamp = null;

// ========================================
// SOCKET.IO EVENT HANDLERS
// ========================================

// Store Socket.IO event handler references for cleanup
const socketHandlers = {
  debug_data: null,
  acc_data: null,
  electrical: null
};

// Wrap socket.on to store handler references
function registerSocketHandler(eventName, handler) {
  socketHandlers[eventName] = handler;
  socket.on(eventName, handler);
}

/**
 * Handle real-time debug data from server
 * Processes speed, torque, setpoint, PWM values
 * Accumulates data points until timestamp changes
 */
registerSocketHandler('debug_data', function (data) {
  if (isPaused) {
    return; // Ignore data while paused
  }

  // Check if this is a new timestamp (new data point)
  if (data.timestamp !== lastTimestamp) {
    if (lastTimestamp !== null) {
      for (let i = 0; i < currentDataPoint.length; i++) {
        chartData[i].push(currentDataPoint[i]);
      }

      if (chartData[0].length > window.MAX_POINTS) {
        for (let i = 0; i < chartData.length; i++) {
          chartData[i].shift();
        }
      }
    }

    lastTimestamp = data.timestamp;
    currentDataPoint = [data.timestamp, null, null, null, null, null];
  }

  if ('speed' in data) {
    speed = data.speed;
    motor_speed = data.motor_speed;
    queueDOMUpdate('speed', speed, 1);
    currentDataPoint[2] = motor_speed;
    queueDOMUpdate('motor-speed', motor_speed, 0);
  }

  if ('torque_kg' in data && 'motor_torque' in data) {
    torque = data.torque_kg;
    motor_torque = data.motor_torque;
    queueDOMUpdate('torque', torque, 2);
    if ('brake_torque' in data) {
      queueDOMUpdate('brake-torque', data.brake_torque, 1);
    }
    currentDataPoint[3] = motor_torque;
    queueDOMUpdate('motor-torque', motor_torque, 1);
    const powerKW = (motor_torque * motor_speed * 2 * Math.PI) / 60000;
    const displayPower = PowerUnits.convertPower(powerKW, PowerUnits.getPowerUnit());
    queueDOMUpdate('motor-power', displayPower, 1);
    const powerUnit = PowerUnits.getPowerUnit();
    queueDOMUpdate('power-unit-label', powerUnit, 0);
  }

  if ('setpoint' in data) {
    setpoint = data.setpoint;
    pwm = data.pwm;
    queueDOMUpdate('motor-setpoint', setpoint, 1);
    queueDOMUpdate('pwm', pwm, 2);
    currentDataPoint[1] = setpoint;
    currentDataPoint[4] = pwm;
  }

  if ('brake_setpoint' in data) {
    brake_setpoint = data.brake_setpoint;
    queueDOMUpdate('brake-setpoint', brake_setpoint, 1);
  }

  scheduleRender();
});

/**
 * Handle acceleration data from server
 * Updates acceleration chart series
 */
registerSocketHandler('acc_data', function (data) {
  if (isPaused) {
    return; // Ignore data while paused
  }

  if ('brake_acceleration' in data && 'motor_acceleration' in data) {
    currentDataPoint[5] = data.motor_acceleration;
    queueDOMUpdate('motor-acc', data.motor_acceleration, 1);
    queueDOMUpdate('brake-acc', data.brake_acceleration, 1);
  }

  scheduleRender();
});

// ========================================
// RESIZE HANDLING
// ========================================

/**
 * Handle chart container resize
 * Updates uPlot dimensions to match container
 */
function handleResize() {
  const container = document.getElementById('chart');
  if (uplot && container) {
    uplot.setSize({
      width: container.clientWidth,
      height: container.clientHeight - 55
    });
  }
}

// ========================================
// RESIZE HANDLE
// ========================================

/**
 * Initialize drag handle for chart height adjustment
 * User can drag handle to resize chart vertically
 */
function initResizeHandle() {
  const resizeHandle = document.getElementById('chart-resize-handle');
  const chartRow = resizeHandle?.closest('.card')?.querySelector('.card-body .row');

  if (!resizeHandle || !chartRow) return;

  let isResizing = false;
  let startY = 0;
  let startHeight = 0;

  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startY = e.clientY;
    startHeight = chartRow.offsetHeight;

    // Prevent text selection during drag
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ns-resize';

    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const deltaY = e.clientY - startY;
    const newHeight = Math.max(200, startHeight + deltaY); // Minimum 200px height

    chartRow.style.height = newHeight + 'px';

    // Resize the chart
    handleResize();
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
  });
}

// ========================================
// INITIALIZATION
// ========================================

// Initialize chart when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  makeChart();
  window.addEventListener('resize', handleResize);
  initResizeHandle();
});

// ========================================
// GRAPH CONTROLS
// ========================================

// Reset graph button handler
document.getElementById('reset-graph')?.addEventListener('click', resetGraph);

/**
 * Reset chart data and clear display
 */
function resetGraph() {
  // Clear all data arrays
  chartData = [
    [], // [0] Time values (seconds)
    [], // [1] Setpoint
    [], // [2] Speed
    [], // [3] Torque
    [],  // [4] PWM
    []
  ];

  // Reset tracking variables
  lastTimestamp = null;
  currentDataPoint = [null, null, null, null, null, null];

  // Reset the chart if it exists
  if (uplot) {
    uplot.setData(chartData);
  }

  // Reset the displayed values
  updateDOMElement('speed', '0', 0);
  updateDOMElement('torque', '0', 0);
  updateDOMElement('brake-torque', '0', 0);
  updateDOMElement('motor-setpoint', '0', 0);
  updateDOMElement('pwm', '0', 0);
}


registerSocketHandler('electrical', function (data) {
  if (isPaused) {
    return;
  }
  if ('current' in data) {
    queueDOMUpdate('current', data.current, 2);
  }
});

// successSavedConfiguration feedback moved to utils.js

// ========================================
// PAUSE/RESUME CONTROL
// ========================================

// Pause graph button handler
document.getElementById('pause-graph')?.addEventListener('click', togglePause);

/**
 * Toggle chart pause/resume state
 * When paused, incoming data is ignored
 */
function togglePause() {
  isPaused = !isPaused;
  const pauseBtn = document.getElementById('pause-graph');

  if (isPaused) {
    pauseBtn.innerHTML = '<i class="bi bi-play-btn-fill"></i> Resume';
    pauseBtn.classList.remove('btn-warning');
    pauseBtn.classList.add('btn-success');
  } else {
    pauseBtn.innerHTML = '<i class="bi bi-pause-btn-fill"></i> Pause';
    pauseBtn.classList.remove('btn-success');
    pauseBtn.classList.add('btn-warning');
  }
}

// ========================================
// CHART UPDATE API
// ========================================

/**
 * Update chart axis parameters
 * Called when graph configuration changes
 */
window.updateChartParameters = function (params) {
  Object.assign(window, params);
};

/**
 * Refresh/recreate chart with new configuration
 * Preserves current data when recreating
 */
window.refreshChart = function () {
  if (uplot) {
    uplot.destroy();
    makeChart();
    uplot.setData(chartData);
  }
};

/**
 * Update chart mode (Torque/Speed/Dynamic)
 * Changes setpoint axis based on mode
 */
window.updateChartMode = function (mode) {
  currentMode = mode;
  if (window.refreshChart) {
    window.refreshChart();
  }
};

// ========================================
// FFT ANALYSIS
// ========================================

// FFT graph button - opens modal and clears previous chart
document.getElementById("fft-graph").addEventListener("click", function () {
  const modalEl = document.getElementById("fftModal");
  const modal = new bootstrap.Modal(modalEl);
  modal.show();

  // Clear the FFT chart when modal opens
  document.getElementById("fft-chart").innerHTML = "";
});

// FFT button handlers (with active button state) defined below

/**
 * Compute and plot FFT for a signal
 * Converts time-domain data to frequency domain
 * @param {Array} signalArray - Array of time-domain values
 * @param {string} label - Label for the plot ("Speed" or "Torque")
 */
function plotFFTFromSignal(signalArray, label) {
  const time = chartData[0];

  if (signalArray.length < 2 || time.length < 2) {
    alert("Not enough data for FFT.");
    return;
  }

  const dt = (time[1] - time[0]) / 1000; // Convert ms to seconds
  const sampleRate = 1 / dt;

  const size = 2 ** Math.floor(Math.log2(signalArray.length));
  const input = signalArray.slice(0, size);

  const fft = new FFT(size, sampleRate);
  fft.forward(input);

  const frequencies = [];
  const magnitudes = [];

  for (let i = 0; i < fft.spectrum.length; i++) {
    frequencies.push(i * sampleRate / size);
    magnitudes.push(fft.spectrum[i]);
  }

  // Small delay to ensure modal is rendered before plotting
  setTimeout(() => {
    document.getElementById("fft-chart").innerHTML = "";

    const opts = {
      title: `FFT of ${label}`,
      titleColor: "#ffffff",
      background: "transparent",
      width: document.getElementById("fft-chart").offsetWidth,
      height: 300,
      scales: {
        x: { time: false },
      },
      axes: [
        {
          label: "Frequency (Hz)",
          labelSize: 20,
          size: 40,
          stroke: "#ffffff",
          labelColor: "#ffffff",
          ticks: { stroke: "#ffffff" },
          grid: { stroke: "rgba(255,255,255,0.15)" },
          values: (u, vals) => vals.map(v => v.toFixed(1)),
        },
        {
          label: "Magnitude",
          labelSize: 20,
          size: 50,
          stroke: "#ffffff",
          labelColor: "#ffffff",
          ticks: { stroke: "#ffffff" },
          grid: { stroke: "rgba(255,255,255,0.15)" },
        }
      ],
      series: [
        {},
        {
          label: "Magnitude",
          stroke: "#F0B823",
          width: 1,
          labelColor: "#ffffff",
        }
      ],
    };

    new uPlot(opts, [frequencies, magnitudes], document.getElementById("fft-chart"));
  }, 100);
}

const speedBtn = document.getElementById("select-speed");
const torqueBtn = document.getElementById("select-torque");

function setActiveButton(activeBtn) {
  [speedBtn, torqueBtn].forEach(btn => {
    btn.classList.remove("btn-warning");
    btn.classList.add("btn-outline-warning");
  });
  activeBtn.classList.remove("btn-outline-warning");
  activeBtn.classList.add("btn-warning");
}

speedBtn.addEventListener("click", () => {
  setActiveButton(speedBtn);
  plotFFTFromSignal(chartData[2], "Speed");
});

torqueBtn.addEventListener("click", () => {
  setActiveButton(torqueBtn);
  plotFFTFromSignal(chartData[3], "Torque");
});

// ========================================
// POWER UNIT HANDLERS
// ========================================

/**
 * Update power unit label when unit changes
 */
function updatePowerUnitLabel() {
  const unit = PowerUnits.getPowerUnit();
  document.getElementById('power-unit-label').textContent = unit;
}

// Listen for power unit changes
window.addEventListener('powerUnitChanged', updatePowerUnitLabel);

// Also listen for storage events from other tabs
window.addEventListener('storage', function (e) {
  if (e.key === 'opendyno_power_unit' && e.newValue) {
    updatePowerUnitLabel();
  }
});

// ========================================
// CLEANUP HANDLERS (Memory leak prevention)
// ========================================

// Cleanup function for page unload
function cleanupDebugChart() {
  // Cancel any pending render frame
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
    _chartDirty = false;
  }

  // Destroy chart instance
  if (uplot) {
    uplot.destroy();
    uplot = null;
  }

  // Clear chart data arrays
  chartData.forEach(arr => arr.length = 0);

  // Remove Socket.IO event listeners
  Object.entries(socketHandlers).forEach(([eventName, handler]) => {
    if (handler) {
      socket.off(eventName, handler);
    }
  });

  // Clear DOM cache
  Object.keys(domCache).forEach(key => {
    delete domCache[key];
  });
}

// Register cleanup on page unload
window.addEventListener('beforeunload', cleanupDebugChart);
