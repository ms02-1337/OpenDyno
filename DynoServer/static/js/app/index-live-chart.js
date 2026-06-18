/**
 * index-live-chart.js - Main page live charting
 */

// ========================================
// CHART STATE
// ========================================

let uplot;
let maxMotorSpeed = 0;
let maxTorque = 0;
let maxPower = 0;
let maxTorqueRpm = 0;  // RPM at which max torque was achieved
let maxPowerRpm = 0;   // RPM at which max power was achieved
let speedToCalculatePower = 0;
let currentMode = 'default'; // 'default', 'speed', 'torque', or 'dynamic'
window.isRunning = false;
let testStarted = false;

let shouldPlotData = true;

// ========================================
// CHART CONFIGURATION
// ========================================

let graphConfigurations = {
  live_graph: {},
  speed_graph: {},
  torque_graph: {},
  dynamic_graph: {}
};

let chartData = {
  time: [],
  speed: [],
  torque: [],
  power: [],
  dynamic: {
    speed: [],
    power: [],
    torque: []
  }
};

let rawData = {
  speed: [],
  torque: [],
  dynamic: {
    speed: [],
    torque: []
  }
};

// ========================================
// CONSTANTS
// ========================================

const CHART_CONFIG = {
  MAX_POINTS: 1000,

  // Default axis ranges
  defaultRanges: {
    speed: { min: 0, max: 1000 },
    torque: { min: 0, max: 100 },
    power: { min: 0, max: 100 }
  }
};

// ========================================
// MODE CONFIGURATIONS
// ========================================

// Mode-specific chart configurations (series, axes, labels)
const MODE_CONFIGS = {
  default: {
    title: "Speed & Torque",
    series: [
      {
        label: "Time",
        value: (u, val, sidx, didx) => {
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
      {
        label: "Speed (rpm)",
        stroke: "red",
        scale: "y",
        value: (u, val, sidx, didx) => {
          const value = didx == null ? u.data[sidx][u.data[sidx].length - 1] : val;
          return value == null ? null : value.toFixed(1) + " rpm";
        },
        paths: uPlot.paths.spline()
      },
      {
        label: "Torque (Nm)",
        stroke: "blue",
        scale: "y1",
        value: (u, val, sidx, didx) => {
          const value = didx == null ? u.data[sidx][u.data[sidx].length - 1] : val;
          return value == null ? null : value.toFixed(1) + " Nm";
        },
        paths: uPlot.paths.spline()
      },
      {
        label: "Power (kW)",
        stroke: "green",
        scale: "y2",
        value: (u, val, sidx, didx) => {
          const value = didx == null ? u.data[sidx][u.data[sidx].length - 1] : val;
          if (value == null) return null;
          const unit = PowerUnits.getPowerUnit();
          return value.toFixed(2) + " " + unit;
        },
        paths: uPlot.paths.spline()
      }
    ],
    axes: [
      {
        label: "Time (s)",
        values: (u, vals) => vals.map(v => {
          if (v == null) return null;
          const totalSeconds = Math.floor(v / 1000);
          const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
          const seconds = (totalSeconds % 60).toString().padStart(2, '0');
          return `${minutes}:${seconds}`;
        }),
        scale: 'x',
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
        splits: (u, axisIdx, scaleMin, scaleMax) => {
          const rangeMs = scaleMax - scaleMin;
          const visibleSeconds = rangeMs / 1000;
          const step = visibleSeconds > 30 ? 5000 : 1000;
          const splits = [];
          for (let t = Math.ceil(scaleMin / step) * step; t <= scaleMax; t += step) {
            splits.push(t);
          }
          return splits;
        },
        space: (self, axisIdx, scaleMin, scaleMax, plotDim) => {
          const minPixelsPerSecond = 80;
          const visibleSeconds = (scaleMax - scaleMin) / 1000;
          return Math.max(minPixelsPerSecond, plotDim / visibleSeconds);
        }
      },
      {
        label: "Speed (rpm)",
        scale: "y",
        values: (u, vals) => vals.map(v => v == null ? null : v.toFixed(0))
      },
      {
        side: 1,
        label: "Torque (Nm)",
        scale: "y1",
        grid: { show: false },
        values: (u, vals) => vals.map(v => v == null ? null : v.toFixed(0))
      },
      {
        side: 1,
        label: "Power (kW)",
        scale: "y2",
        grid: { show: false },
        values: (u, vals) => vals.map(v => v == null ? null : v.toFixed(1))
      }
    ]
  },
  speed: {
    title: "Speed Mode",
    series: [
      {
        label: "Time",
        value: (u, val, sidx, didx) => {
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
      {
        label: "Speed (rpm)",
        stroke: "red",
        scale: "y",
        value: (u, val, sidx, didx) => {
          const value = didx == null ? u.data[sidx][u.data[sidx].length - 1] : val;
          return value == null ? null : value.toFixed(1) + " rpm";
        },
        paths: uPlot.paths.spline()
      },
      {
        label: "Torque (Nm)",
        stroke: "blue",
        scale: "y1",
        value: (u, val, sidx, didx) => {
          const value = didx == null ? u.data[sidx][u.data[sidx].length - 1] : val;
          return value == null ? null : value.toFixed(1) + " Nm";
        },
        paths: uPlot.paths.spline()
      },
      {
        label: "Power (kW)",
        stroke: "green",
        scale: "y2",
        value: (u, val, sidx, didx) => {
          const value = didx == null ? u.data[sidx][u.data[sidx].length - 1] : val;
          if (value == null) return null;
          const unit = PowerUnits.getPowerUnit();
          return value.toFixed(2) + " " + unit;
        },
        paths: uPlot.paths.spline()
      }
    ],
    axes: [
      {
        label: "Time (s)",
        values: (u, vals) => vals.map(v => {
          if (v == null) return null;
          const totalSeconds = Math.floor(v / 1000);
          const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
          const seconds = (totalSeconds % 60).toString().padStart(2, '0');
          return `${minutes}:${seconds}`;
        }),
        scale: 'x',
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
        splits: (u, axisIdx, scaleMin, scaleMax) => {
          const rangeMs = scaleMax - scaleMin;
          const visibleSeconds = rangeMs / 1000;
          const step = visibleSeconds > 30 ? 5000 : 1000;
          const splits = [];
          for (let t = Math.ceil(scaleMin / step) * step; t <= scaleMax; t += step) {
            splits.push(t);
          }
          return splits;
        },
        space: (self, axisIdx, scaleMin, scaleMax, plotDim) => {
          const minPixelsPerSecond = 80;
          const visibleSeconds = (scaleMax - scaleMin) / 1000;
          return Math.max(minPixelsPerSecond, plotDim / visibleSeconds);
        }
      },
      {
        label: "Speed (rpm)",
        scale: "y"
      },
      {
        side: 1,
        label: "Torque (Nm)",
        scale: "y1",
        grid: { show: false }
      },
      {
        side: 1,
        label: "Power (kW)",
        scale: "y2",
        grid: { show: false },
        values: (u, vals) => vals.map(v => v == null ? null : v.toFixed(1))
      }
    ]
  },
  torque: {
    title: "Torque Mode",
    series: [
      {
        label: "Time",
        value: (u, val, sidx, didx) => {
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
      {
        label: "Speed (rpm)",
        stroke: "red",
        scale: "y",
        value: (u, val, sidx, didx) => {
          const value = didx == null ? u.data[sidx][u.data[sidx].length - 1] : val;
          return value == null ? null : value.toFixed(1) + " rpm";
        },
        paths: uPlot.paths.spline()
      },
      {
        label: "Torque (Nm)",
        stroke: "blue",
        scale: "y1",
        value: (u, val, sidx, didx) => {
          const value = didx == null ? u.data[sidx][u.data[sidx].length - 1] : val;
          return value == null ? null : value.toFixed(1) + " Nm";
        },
        paths: uPlot.paths.spline()
      },
      {
        label: "Power (kW)",
        stroke: "green",
        scale: "y2",
        value: (u, val, sidx, didx) => {
          const value = didx == null ? u.data[sidx][u.data[sidx].length - 1] : val;
          if (value == null) return null;
          const unit = PowerUnits.getPowerUnit();
          return value.toFixed(2) + " " + unit;
        },
        paths: uPlot.paths.spline()
      }
    ],
    axes: [
      {
        label: "Time (s)",
        values: (u, vals) => vals.map(v => {
          if (v == null) return null;
          const totalSeconds = Math.floor(v / 1000);
          const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
          const seconds = (totalSeconds % 60).toString().padStart(2, '0');
          return `${minutes}:${seconds}`;
        }),
        scale: 'x',
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
        splits: (u, axisIdx, scaleMin, scaleMax) => {
          const rangeMs = scaleMax - scaleMin;
          const visibleSeconds = rangeMs / 1000;
          const step = visibleSeconds > 30 ? 5000 : 1000;
          const splits = [];
          for (let t = Math.ceil(scaleMin / step) * step; t <= scaleMax; t += step) {
            splits.push(t);
          }
          return splits;
        },
        space: (self, axisIdx, scaleMin, scaleMax, plotDim) => {
          const minPixelsPerSecond = 80;
          const visibleSeconds = (scaleMax - scaleMin) / 1000;
          return Math.max(minPixelsPerSecond, plotDim / visibleSeconds);
        }
      },
      {
        label: "Speed (rpm)",
        scale: "y"
      },
      {
        side: 1,
        label: "Torque (Nm)",
        scale: "y1",
        grid: { show: false }
      },
      {
        side: 1,
        label: "Power (kW)",
        scale: "y2",
        grid: { show: false },
        values: (u, vals) => vals.map(v => v == null ? null : v.toFixed(1))
      }
    ]
  },
  dynamic: {
    title: "Power & Torque",
    series: [
      {
        label: "Speed (rpm)",
        value: (u, val, sidx, didx) => {
          const value = didx == null ? u.data[sidx][u.data[sidx].length - 1] : val;
          return value == null ? null : value.toFixed(0);
        }
      },
      {
        label: "Power (kW)",
        stroke: "green",
        scale: "y",
        value: (u, val, sidx, didx) => {
          const value = didx == null ? u.data[sidx][u.data[sidx].length - 1] : val;
          if (value == null) return null;
          const unit = PowerUnits.getPowerUnit();
          return value.toFixed(2) + " " + unit;
        },
        paths: uPlot.paths.spline()
      },
      {
        label: "Torque (Nm)",
        stroke: "blue",
        scale: "y1",
        value: (u, val, sidx, didx) => {
          const value = didx == null ? u.data[sidx][u.data[sidx].length - 1] : val;
          return value == null ? null : value.toFixed(1) + " Nm";
        },
        paths: uPlot.paths.spline()
      }
    ],
    axes: [
      {
        label: "Speed (rpm)",
        scale: "x",
        values: (u, vals) => vals.map(v => v == null ? null : v.toFixed(0))
      },
      {
        label: "Power (kW)",
        scale: "y",
        values: (u, vals) => vals.map(v => v == null ? null : v.toFixed(0))
      },
      {
        side: 1,
        label: "Torque (Nm)",
        scale: "y1",
        grid: { show: false },
        values: (u, vals) => vals.map(v => v == null ? null : v.toFixed(0))
      }
    ]
  }
};

// ========================================
// INITIALIZATION
// ========================================

document.addEventListener("DOMContentLoaded", () => {
  initializeChart();
  setupEventListeners();
  initializeMaxValuesDisplay();
});

// ========================================
// DISPLAY FUNCTIONS
// ========================================

/**
 * Initialize max values display on page load
 */
function initializeMaxValuesDisplay() {
  // Initialize max values display with current values (or '-' if first run)
  refreshMaxValuesDisplay();
}

/**
 * Refresh max values display with current tracked values
 */
function refreshMaxValuesDisplay() {
  // Refresh max values display with current values
  document.getElementById('max-motor-speed').textContent = maxMotorSpeed > 0 ? maxMotorSpeed.toFixed(0) : '-';
  document.getElementById('max-torque').textContent = maxTorque > 0 ? maxTorque.toFixed(0) : '-';
  document.getElementById('max-torque-rpm').textContent = maxTorque > 0 ? `Nm @ ${maxTorqueRpm.toFixed(0)} RPM` : 'Nm @ - RPM';
  const unit = PowerUnits.getPowerUnit();
  const displayMaxPower = maxPower > 0 ? PowerUnits.convertPower(maxPower, unit) : 0;
  document.getElementById('max-power').textContent = maxPower > 0 ? displayMaxPower.toFixed(2) : '-';
  document.getElementById('max-power-rpm').textContent = maxPower > 0 ? `${unit} @ ${maxPowerRpm.toFixed(0)} RPM` : `${unit} @ - RPM`;
}

/**
 * Initialize chart with default mode
 */
function initializeChart() {
  makeChart('default');
}

/**
 * Set up all event listeners for the page
 * Handles mode selection, run/stop/reset buttons
 */
function setupEventListeners() {
  // Mode selector
  const modeSelect = document.getElementById('mode-input');
  if (modeSelect) {
    modeSelect.addEventListener('change', (e) => {
      const selectedValue = e.target.value;
      let chartMode;
      switch (selectedValue) {
        case 'Speed': chartMode = 'speed'; break;
        case 'Torque': chartMode = 'torque'; break;
        case 'Dynamic': chartMode = 'dynamic'; break;
        default: chartMode = 'default';
      }
      switchChartMode(chartMode);
    });
  }

  // Run test button
  document.getElementById('run-test').addEventListener('click', function () {
    const url = window.isRunning ? '/api/stop' : '/api/run';

    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (data.message === 'success') {
          window.isRunning = !window.isRunning;
          if (typeof updateButtonState === 'function') {
            updateButtonState(window.isRunning);
          }

          if (window.isRunning) {
            // Starting (either fresh or after stop)
            resetTestData();
            updateChart();
            shouldPlotData = true;

            // Switch to appropriate chart mode based on selected mode
            const modeSelect = document.getElementById('mode-input');
            let chartMode;
            switch (modeSelect.value) {
              case 'Speed': chartMode = 'speed'; break;
              case 'Torque': chartMode = 'torque'; break;
              case 'Dynamic': chartMode = 'dynamic'; break;
              default: chartMode = 'default';
            }
            switchChartMode(chartMode);
          } else {
            // Stopping - keep chart frozen in current mode (don't switch to default)
            shouldPlotData = false;
            testStarted = false;
            stopTimer();
          }
        } else {
          throw new Error(data.message || 'Unknown API error');
        }
      })
      .catch(error => {
        console.error('Error in run-test:', error);
        if (typeof showAlert === 'function') {
          showAlert(`Error: ${error.message || 'Unknown error occurred'}`);
        } else if (window.DynoUtils) {
          window.DynoUtils.showAlert(`Error: ${error.message || 'Unknown error occurred'}`, 'danger');
        }
      });
  });

  // Reset test button
  document.getElementById('reset-test').addEventListener('click', function () {
    // Remember current running state and chart mode
    const wasRunning = window.isRunning;
    const previousMode = currentMode;

    // Reset all data including max values
    resetTestData();

    // If test was not running, switch to default mode (live graph)
    // If test was running, preserve current mode
    if (!wasRunning) {
      switchChartMode('default');
    } else {
      switchChartMode(previousMode);
    }

    shouldPlotData = true;
    updateChart();

    // If test was running, restart the timer
    if (wasRunning) {
      startTimer();
    }
  });
}

// ========================================
// DATA RESET FUNCTIONS
// ========================================

/**
 * Reset all test data (max values, chart data, timer, displays)
 */
function resetTestData() {
  testStarted = false;

  // Reset max values
  maxMotorSpeed = 0;
  maxTorque = 0;
  maxPower = 0;
  maxTorqueRpm = 0;
  maxPowerRpm = 0;

  // Reset chart data
  chartData = {
    time: [],
    speed: [],
    torque: [],
    power: [],
    dynamic: {
      speed: [],
      power: [],
      torque: []
    }
  };

  rawData = {
    speed: [],
    torque: [],
    dynamic: {
      speed: [],
      torque: []
    }
  };

  // Reset timer
  resetTimer();

  // Reset all display elements including max values
  document.getElementById('max-motor-speed').textContent = '-';
  document.getElementById('max-torque').textContent = '-';
  document.getElementById('max-torque-rpm').textContent = 'Nm @ - RPM';
  document.getElementById('max-power').textContent = '-';
  document.getElementById('max-power-rpm').textContent = `${PowerUnits.getPowerUnit()} @ - RPM`;
  document.getElementById('motor-speed').textContent = '0';
  document.getElementById('torque_value').textContent = '0';
  document.getElementById('power_value').textContent = '0';

  torqueIIRFilter.reset();
  speedAvgFilter.reset();
}

// ========================================
// CHART MODE FUNCTIONS
// ========================================

/**
 * Apply mode-specific settings and recreate chart
 */
function applyModeSettings(mode) {
  // Update chart configuration
  makeChart(mode);

  // Update global ranges
  const ranges = getModeRanges(mode);
  window.MIN_SPEED = ranges.speed.min;
  window.MAX_SPEED = ranges.speed.max;
  window.MIN_TORQUE = ranges.torque.min;
  window.MAX_TORQUE = ranges.torque.max;
  window.MIN_POWER = ranges.power.min;
  window.MAX_POWER = ranges.power.max;
}

function getModeRanges(mode) {
  switch (mode) {
    case 'speed':
      return {
        speed: {
          min: Number(graphConfigurations.speed_graph.speed_min) || 0,
          max: Number(graphConfigurations.speed_graph.speed_max) || 1000
        },
        torque: {
          min: Number(graphConfigurations.speed_graph.torque_min) || 0,
          max: Number(graphConfigurations.speed_graph.torque_max) || 100
        },
        power: {
          min: Number(graphConfigurations.speed_graph.power_min) || 0,
          max: Number(graphConfigurations.speed_graph.power_max) || 100
        }
      };
    case 'torque':
      return {
        speed: {
          min: Number(graphConfigurations.torque_graph.speed_min) || 0,
          max: Number(graphConfigurations.torque_graph.speed_max) || 1000
        },
        torque: {
          min: Number(graphConfigurations.torque_graph.torque_min) || 0,
          max: Number(graphConfigurations.torque_graph.torque_max) || 100
        },
        power: {
          min: Number(graphConfigurations.torque_graph.power_min) || 0,
          max: Number(graphConfigurations.torque_graph.power_max) || 100
        }
      };
    case 'dynamic':
      return {
        speed: {
          min: Number(graphConfigurations.dynamic_graph.rpm_min) || 0,
          max: Number(graphConfigurations.dynamic_graph.rpm_max) || 8000
        },
        torque: {
          min: Number(graphConfigurations.dynamic_graph.torque_min) || 0,
          max: Number(graphConfigurations.dynamic_graph.torque_max) || 100
        },
        power: {
          min: Number(graphConfigurations.dynamic_graph.power_min) || 0,
          max: Number(graphConfigurations.dynamic_graph.power_max) || 200
        }
      };
    default: // live_graph
      return {
        speed: {
          min: Number(graphConfigurations.live_graph.speed_min) || 0,
          max: Number(graphConfigurations.live_graph.speed_max) || 1000
        },
        torque: {
          min: Number(graphConfigurations.live_graph.torque_min) || 0,
          max: Number(graphConfigurations.live_graph.torque_max) || 100
        },
        power: {
          min: Number(graphConfigurations.live_graph.power_min) || 0,
          max: Number(graphConfigurations.live_graph.power_max) || 100
        }
      };
  }
}

/**
 * Create uPlot chart with specified mode configuration
 */
function makeChart(mode) {
  const config = MODE_CONFIGS[mode] || MODE_CONFIGS.default;
  const ranges = getModeRanges(mode);

  if (uplot) {
    uplot.destroy();
  }

  // Get current power unit for dynamic labels
  const powerUnit = PowerUnits.getPowerUnit();
  const powerLabel = `Power (${powerUnit})`;

  // Update power series label dynamically
  const series = config.series.map(s => {
    if (s.label && s.label.includes('Power')) {
      return { ...s, label: powerLabel };
    }
    return s;
  });

  // Update power axis label dynamically
  const axes = config.axes.map(a => {
    if (a.label && a.label.includes('Power')) {
      return { ...a, label: powerLabel };
    }
    return a;
  });

  const opts = {
    title: config.title,
    width: document.getElementById('chart').clientWidth,
    height: document.getElementById('chart').clientHeight - 55,
    scales: {
      x: {
        time: mode !== 'dynamic',
        range: mode === 'dynamic' ? [ranges.speed.min, ranges.speed.max] : undefined
      },
      y: {
        range: mode === 'dynamic' ? [PowerUnits.convertPower(ranges.power.min, powerUnit), PowerUnits.convertPower(ranges.power.max, powerUnit)] : [ranges.speed.min, ranges.speed.max]
      },
      y1: {
        range: [ranges.torque.min, ranges.torque.max]
      },
      y2: {
        range: [PowerUnits.convertPower(ranges.power.min, powerUnit), PowerUnits.convertPower(ranges.power.max, powerUnit)]
      }
    },
    cursor: {
      drag: {
        x: true,  // Enable dragging horizontally
        y: false
      }
    },
    series: series,
    axes: axes
  };

  const convertPowerData = (arr) => arr.map(v => PowerUnits.convertPower(v, powerUnit));

  // Prepare data based on current mode
  let displayData;
  if (mode === 'dynamic') {
    displayData = [
      chartData.dynamic.speed,
      convertPowerData(chartData.dynamic.power),
      chartData.dynamic.torque
    ];
  } else {
    displayData = [
      chartData.time,
      chartData.speed,
      chartData.torque,
      convertPowerData(chartData.power)
    ];
  }

  uplot = new uPlot(opts, displayData, document.getElementById('chart'));
  handleResize();
}

/**
 * Switch to different chart mode
 */
function switchChartMode(newMode) {
  if (newMode === currentMode) return;

  currentMode = newMode;
  applyModeSettings(newMode);
}

/**
 * Update chart with current data
 * Chooses correct data format based on current mode
 */
function updateChart() {
  if (!uplot) return;

  const powerUnit = PowerUnits.getPowerUnit();
  const convertPowerData = (arr) => arr.map(v => PowerUnits.convertPower(v, powerUnit));

  let displayData;
  if (currentMode === 'dynamic') {
    displayData = [
      chartData.dynamic.speed,
      convertPowerData(chartData.dynamic.power),
      chartData.dynamic.torque
    ];
  } else {
    displayData = [
      chartData.time,
      chartData.speed,
      chartData.torque,
      convertPowerData(chartData.power)
    ];
  }

  // Ensure we have at least 2 points for line drawing
  if (displayData[0].length === 1) {
    displayData.forEach(series => {
      if (series.length === 1) series.push(series[0]);
    });
  }

  scheduleRender(displayData);
}

// ========================================
// RENDER SCHEDULING (requestAnimationFrame batching)
// ========================================

// Dirty flag + rAF handle: guarantees at most 1 setData() + DOM flush per display frame.
let _chartDirty = false;
let _rafId = null;
let _pendingDisplayData = null;

// DOM element cache and pending text updates (flushed once per frame).
const _domCache = {};
const _pendingDOM = {};

/**
 * Get DOM element by ID with caching.
 */
function _getCachedEl(id) {
  if (!_domCache[id]) {
    _domCache[id] = document.getElementById(id);
  }
  return _domCache[id];
}

/**
 * Queue a DOM text update to be applied on the next animation frame.
 * @param {string} id       - Element ID
 * @param {*}      value    - Value to display
 * @param {number} decimals - Decimal places (for numbers)
 */
function queueDOMUpdate(id, value, decimals = 1) {
  _pendingDOM[id] = typeof value === 'number' ? value.toFixed(decimals) : String(value);
  // Ensure a rAF is scheduled (cheap no-op if already queued)
  if (!_chartDirty) {
    _chartDirty = true;
    _rafId = requestAnimationFrame(_renderChart);
  }
}

/**
 * Mark chart data as changed and schedule a single render on the next frame.
 * Calling this multiple times before the frame fires is a no-op.
 * @param {Array} displayData - The data arrays to pass to uplot.setData()
 */
function scheduleRender(displayData) {
  // Always update the staged data so the latest snapshot is used when the
  // frame eventually fires (handles rapid back-to-back calls correctly).
  _pendingDisplayData = displayData;
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
    const el = _getCachedEl(id);
    if (el && el.textContent !== _pendingDOM[id]) {
      el.textContent = _pendingDOM[id];
    }
    delete _pendingDOM[id];
  }

  // Render chart
  if (!uplot || !_pendingDisplayData) return;
  uplot.setData(_pendingDisplayData);
  _pendingDisplayData = null;
}

// ========================================
// SOCKET.IO EVENT HANDLERS
// ========================================

// Store Socket.IO event handler references for cleanup
const socketHandlers = {
  live_data: null,
  status: null
};

// Wrap socket.on to store handler references
function registerSocketHandler(eventName, handler) {
  socketHandlers[eventName] = handler;
  socket.on(eventName, handler);
}

/**
 * Handle system status updates
 * Updates status badge and controls timer based on test state
 */
registerSocketHandler('status', function (data) {
  const badge = document.getElementById('info-live');

  if (data.info == "Inestable Speed") {
    badge.textContent = "Full throttle";
    badge.classList.remove('text-bg-danger', 'text-bg-success');
    badge.classList.add('text-bg-warning'); // Yellow/orange
  } else if (data.info == "Running Test") {
    badge.textContent = "Running Test";
    badge.classList.remove('text-bg-danger', 'text-bg-warning');
    badge.classList.add('text-bg-success'); // Green
    testStarted = true;
    startTimer();
  } else if (data.info == "Stopping Dyno") {
    badge.textContent = "Stopping Dyno";
    badge.classList.remove('text-bg-success', 'text-bg-warning');
    badge.classList.add('text-bg-danger'); // Red
  } else if (data.info == "Holding Limit Speed") {
    badge.textContent = "Holding Limit Speed";
    badge.classList.remove('text-bg-success', 'text-bg-warning');
    badge.classList.add('text-bg-warning'); // Yellow/orange
    // Stop timer when holding final speed
    testStarted = false;
    stopTimer();
  } else {
    badge.textContent = data.info;
    badge.classList.remove('text-bg-success', 'text-bg-warning');
    badge.classList.add('text-bg-danger'); // Red
  }
});

// ========================================
// TIMER FUNCTIONS
// ========================================

let timerInterval = null;
let startTime = null;
let timerRunning = false;
let elapsedBeforePause = 0; // Track elapsed time before pause
let totalElapsedSeconds = 0; // Track total elapsed time for saving (in seconds)

/**
 * Start the test timer
 * Uses requestAnimationFrame for smooth updates
 */
function startTimer() {
  if (timerRunning) return; // already running

  if (startTime === null) {
    // First start - initialize start time
    startTime = performance.now();
  } else {
    // Resume after pause - adjust start time to account for elapsed time
    startTime = performance.now() - elapsedBeforePause;
  }

  timerRunning = true;
  timerInterval = requestAnimationFrame(updateTimer);
}

/**
 * Stop the test timer and save elapsed time
 */
function stopTimer() {
  if (!timerRunning) return;

  cancelAnimationFrame(timerInterval);
  timerInterval = null;
  timerRunning = false;

  // Save the elapsed time for potential resume and for saving
  if (startTime !== null) {
    elapsedBeforePause = performance.now() - startTime;
    totalElapsedSeconds = elapsedBeforePause / 1000; // Convert to seconds
  }
}

/**
 * Reset timer to initial state
 */
function resetTimer() {
  stopTimer();
  startTime = null;
  elapsedBeforePause = 0;
  totalElapsedSeconds = 0;
  document.getElementById('time-elapsed').textContent = '-';
}

/**
 * Update timer display (called via requestAnimationFrame)
 */
function updateTimer() {
  if (!startTime || !timerRunning) return;

  const now = performance.now();
  const elapsed = now - startTime; // milliseconds
  const secondsDecimal = (elapsed / 1000).toFixed(1); // 1 decimal

  document.getElementById('time-elapsed').textContent = secondsDecimal;

  // Update total elapsed time for saving
  totalElapsedSeconds = elapsed / 1000;

  // Continue updating if timer is running
  if (timerRunning) {
    timerInterval = requestAnimationFrame(updateTimer);
  }
}


// ========================================
// FILTERS
// ========================================

class MovingAverageFilter {
  constructor(windowSize = 3) {
    this.windowSize = windowSize;
    this.values = [];
  }

  filter(measurement) {
    this.values.push(measurement);
    if (this.values.length > this.windowSize) {
      this.values.shift();
    }
    const sum = this.values.reduce((acc, val) => acc + val, 0);
    return sum / this.values.length;
  }

  reset() {
    this.values = [];
  }

  getCurrentWindowSize() {
    return this.values.length;
  }
}

class CascadedIIRFilter {
  constructor(stages, cutoffHz, sampleRateHz) {
    this.stages = stages;
    const tau = 1.0 / (2 * Math.PI * cutoffHz);
    const dt = 1.0 / sampleRateHz;
    this.alpha = Math.exp(-dt / tau);
    this.prev = new Array(stages).fill(null);
  }

  filter(value) {
    let output = value;
    for (let i = 0; i < this.stages; i++) {
      if (this.prev[i] === null) {
        this.prev[i] = output;
        continue;
      }
      this.prev[i] = this.alpha * this.prev[i] + (1 - this.alpha) * output;
      output = this.prev[i];
    }
    return output;
  }

  reset() {
    this.prev = new Array(this.stages).fill(null);
  }
}

let displayFilterEnabled = true;
const torqueIIRFilter = new CascadedIIRFilter(2, 2, 100);
const speedAvgFilter = new MovingAverageFilter(5);

window.setDisplayFilterEnabled = function (enabled) {
  displayFilterEnabled = enabled;
  torqueIIRFilter.reset();
};

// ========================================
// LIVE DATA HANDLER
// ========================================

/**
 * Handle real-time live data from server
 * Applies light moving-average filtering to smooth sensor noise
 * Stores data differently based on mode (time-based vs dynamic)
 */
registerSocketHandler('live_data', function (data) {
  if (!shouldPlotData) return;

  const rawTorqueValue = parseFloat(data.torque) || 0;
  const rawSpeedValue = parseFloat(data.motor_speed) || 0;

  rawData.torque.push(rawTorqueValue);
  rawData.speed.push(rawSpeedValue);

  const filteredSpeedValue = speedAvgFilter.filter(rawSpeedValue);
  const filteredTorqueValue = displayFilterEnabled ? torqueIIRFilter.filter(rawTorqueValue) : rawTorqueValue;

  const powerValue = (filteredTorqueValue * filteredSpeedValue * 2 * Math.PI) / 60000;

  // Update HTML elements using the same filtered values for consistency
  updateDisplayElements(filteredSpeedValue, filteredTorqueValue, powerValue, data);

  chartData.time.push(data.timestamp);
  chartData.speed.push(filteredSpeedValue);
  chartData.torque.push(filteredTorqueValue);
  chartData.power.push(powerValue);

  const infoBadge = document.getElementById('info-live').textContent;

  if (infoBadge === "Running Test") {
    chartData.dynamic.speed.push(filteredSpeedValue);
    chartData.dynamic.power.push(powerValue);
    chartData.dynamic.torque.push(filteredTorqueValue);
    rawData.dynamic.speed.push(rawSpeedValue);
    rawData.dynamic.torque.push(rawTorqueValue);
  }

  if (chartData.time.length > CHART_CONFIG.MAX_POINTS) {
    chartData.time.shift();
    chartData.speed.shift();
    chartData.torque.shift();
    chartData.power.shift();
    rawData.speed.shift();
    rawData.torque.shift();
  }

  updateChart();
});

// ========================================
// DISPLAY ELEMENTS UPDATE
// ========================================

function updateDisplayElements(filteredSpeed, filteredTorque, power, rawData) {
  if ('speed' in rawData && 'motor_speed' in rawData) {
    const brakeSpeedValue = parseFloat(rawData.speed) || 0;
    queueDOMUpdate('motor-speed', filteredSpeed, 0);
    queueDOMUpdate('brake-speed-value', brakeSpeedValue.toFixed(0) + " RPM");
    speedToCalculatePower = filteredSpeed;

    if (testStarted && filteredSpeed > maxMotorSpeed) {
      maxMotorSpeed = filteredSpeed;
      queueDOMUpdate('max-motor-speed', maxMotorSpeed, 0);
    }
  }

  if ('torque' in rawData && 'brake_torque' in rawData) {
    queueDOMUpdate('brake-torque-value', rawData.brake_torque.toFixed(1) + ' Nm');
    queueDOMUpdate('torque_value', filteredTorque, 2);

    const unit = PowerUnits.getPowerUnit();
    const displayPower = PowerUnits.convertPower(power, unit);
    queueDOMUpdate('power_value', displayPower, 2);
    queueDOMUpdate('power-unit-label', unit);

    if (testStarted && filteredTorque > maxTorque) {
      maxTorque = filteredTorque;
      maxTorqueRpm = speedToCalculatePower;
      queueDOMUpdate('max-torque', maxTorque, 0);
      queueDOMUpdate('max-torque-rpm', "Nm @ " + maxTorqueRpm.toFixed(0) + " RPM");
    }

    if (testStarted && power > maxPower) {
      maxPower = power;
      maxPowerRpm = speedToCalculatePower;
      const displayMaxPower = PowerUnits.convertPower(maxPower, unit);
      queueDOMUpdate('max-power', displayMaxPower, 2);
      queueDOMUpdate('max-power-rpm', unit + " @ " + maxPowerRpm.toFixed(0) + " RPM");
    }
  }
}

// ========================================
// RESIZE HANDLER
// ========================================

/**
 * Handle chart resize on window resize
 */
function handleResize() {
  const container = document.getElementById('chart');
  if (uplot) {
    uplot.setSize({
      width: container.clientWidth,
      height: container.clientHeight - 55
    });
  }
}

window.addEventListener('resize', handleResize);

// ========================================
// CLEANUP HANDLERS (Memory leak prevention)
// ========================================

// Cleanup function for page unload
function cleanup() {
  // Cancel any pending render frame
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
    _chartDirty = false;
    _pendingDisplayData = null;
  }

  // Clear pending DOM updates and cache
  for (const id in _pendingDOM) delete _pendingDOM[id];
  for (const id in _domCache) delete _domCache[id];

  // Destroy chart instance
  if (uplot) {
    uplot.destroy();
    uplot = null;
  }

  // Remove Socket.IO event listeners
  if (socketHandlers.live_data) {
    socket.off('live_data', socketHandlers.live_data);
  }
  if (socketHandlers.status) {
    socket.off('status', socketHandlers.status);
  }

  // Cancel any running timers
  stopTimer();
}

// Register cleanup on page unload
window.addEventListener('beforeunload', cleanup);

// Replace direct socket.on calls with registerSocketHandler
// Override the socket.on call for live_data (done at line 1043)
// Override the socket.on call for status (done at line 868)

window.refreshChart = function () {
  if (uplot) {
    makeChart(currentMode);
  }
};

/**
 * Update chart axis parameters - exposed as window API
 */
window.updateChartParameters = function (params) {
  Object.assign(window, params);
  if (uplot) {
    const ranges = getModeRanges(currentMode);
    const powerUnit = PowerUnits.getPowerUnit();
    const pMin = PowerUnits.convertPower(ranges.power.min, powerUnit);
    const pMax = PowerUnits.convertPower(ranges.power.max, powerUnit);
    if (currentMode === 'dynamic') {
      uplot.setScale('x', { min: ranges.speed.min, max: ranges.speed.max });
      uplot.setScale('y', { min: pMin, max: pMax });
    } else {
      uplot.setScale('y', { min: ranges.speed.min, max: ranges.speed.max });
      uplot.setScale('y2', { min: pMin, max: pMax });
    }
    uplot.setScale('y1', { min: ranges.torque.min, max: ranges.torque.max });
  }
};

/**
 * Update graph configurations - exposed as window API
 */
window.updateGraphConfigurations = function (config) {
  if (config.live_graph) {
    graphConfigurations.live_graph = config.live_graph;
  }
  if (config.speed_graph) {
    graphConfigurations.speed_graph = config.speed_graph;
  }
  if (config.torque_graph) {
    graphConfigurations.torque_graph = config.torque_graph;
  }
  if (config.dynamic_graph) {
    graphConfigurations.dynamic_graph = config.dynamic_graph;
  }

  // Update MAX_POINTS based on current mode
  CHART_CONFIG.MAX_POINTS = Number(
    graphConfigurations[currentMode === 'default' ? 'live_graph' :
      currentMode === 'speed' ? 'speed_graph' :
        currentMode === 'torque' ? 'torque_graph' :
          'dynamic_graph'
    ].max_points) || 1000;
};

// ========================================
// TEST SAVE HANDLER
// ========================================

/**
 * Handle test save button click
 * Collects test data and sends to server for persistence
 */
document.getElementById('save-test-button').addEventListener('click', function () {
  const saveButton = document.getElementById('save-test-button');
  const originalText = saveButton.innerHTML;

  // Show "Saving..." state immediately
  saveButton.disabled = true;
  saveButton.innerHTML = '<i class="bi bi-hourglass-split"></i> Saving...';

  // Get the form values
  const testName = document.getElementById('exampleInputEmail1').value;
  const testComment = document.querySelector('#saveTestModal textarea').value;

  // Get current date and time
  const now = new Date();
  const formattedDate = now.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).replace(/\//g, '-');

  // Calculate time elapsed (in seconds)
  let timeElapsed;
  if (timerRunning && startTime !== null) {
    // Timer is currently running - calculate current elapsed time
    timeElapsed = (performance.now() - startTime) / 1000;
  } else {
    // Timer is not running - use saved value
    timeElapsed = totalElapsedSeconds || 0;
  }
  const runMode = currentMode === 'default' ? 'speed' : currentMode;
  let value = 0;
  const motorRatio = parseFloat(document.getElementById('motor-pinions-input')?.value) || 0;
  const dynoRatio = parseFloat(document.getElementById('dyno-pinions-input')?.value) || 0;

  if (currentMode === 'speed') {
    value = parseFloat(document.getElementById('mode-value-input').value) || 0;
  } else if (currentMode === 'torque') {
    value = parseFloat(document.getElementById('mode-value-input').value) || 0;
  }

  // Prepare the data array
  const dataPoints = [];
  let validDataFound = false;

  // Handle data collection based on current mode
  if (currentMode === 'dynamic') {
    for (let i = 0; i < rawData.dynamic.speed.length; i++) {
      const rpm = rawData.dynamic.speed[i] || 0;
      const torque = rawData.dynamic.torque[i] || 0;
      const power = (torque * rpm * 2 * Math.PI) / 60000;

      dataPoints.push({
        rpm: parseFloat(rpm.toFixed(0)),
        torque: parseFloat(torque.toFixed(2)),
        power: parseFloat(power.toFixed(2))
      });
      validDataFound = true;
    }
  } else {
    for (let i = 0; i < chartData.time.length; i++) {
      const timestamp = chartData.time[i] || 0;
      const rpm = rawData.speed[i] || 0;
      const torque = rawData.torque[i] || 0;
      const power = (torque * rpm * 2 * Math.PI) / 60000;

      dataPoints.push({
        timestamp: timestamp,
        rpm: parseFloat(rpm.toFixed(0)),
        torque: parseFloat(torque.toFixed(2)),
        power: parseFloat(power.toFixed(2))
      });
      validDataFound = true;
    }
  }

  if (!validDataFound) {
    alert('No valid test data found to save!');
    saveButton.disabled = false;
    saveButton.innerHTML = originalText;
    return;
  }

  // Create the payload object
  const payload = {
    name: testName,
    comment: testComment,
    date: formattedDate,
    max_torque: parseFloat((maxTorque || 0).toFixed(2)),
    max_power: parseFloat((maxPower || 0).toFixed(2)),
    time_elapsed: parseFloat(timeElapsed.toFixed(2)),
    run_mode: runMode,
    value: parseFloat(value.toFixed(2)),
    motor_ratio: motorRatio,
    dyno_ratio: dynoRatio,
    data: dataPoints
  };

  // Add dynamic-specific fields if in dynamic mode
  if (currentMode === 'dynamic') {
    const startSpeedInput = document.getElementById('start-speed-input');
    payload.start_speed = parseFloat(startSpeedInput ? startSpeedInput.value : 0) || 0;

    const endSpeedInput = document.getElementById('end-speed-input');
    payload.end_speed = parseFloat(endSpeedInput ? endSpeedInput.value : 0) || 0;

    const rampTimeInput = document.getElementById('ramp-time-input');
    payload.ramp_time = parseFloat(rampTimeInput ? rampTimeInput.value : 0) || 0;
  }

  // Make the POST request
  fetch('/api/logs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload)
  })
    .then(response => response.json())
    .then(data => {
      const modalElement = document.getElementById('saveTestModal');
      if (data.message === 'success') {
        saveButton.classList.replace('btn-primary', 'btn-success');
        saveButton.innerHTML = '<i class="bi bi-check-circle"></i> Saved!';
        setTimeout(() => {
          // Reset button color and text
          saveButton.classList.replace('btn-success', 'btn-primary');
          saveButton.innerHTML = originalText;
          saveButton.disabled = false;

          // Close the modal
          const modal = bootstrap.Modal.getInstance(modalElement);
          if (modal) {
            modal.hide();
          } else {
            // Fallback: create new instance and hide
            const newModal = new bootstrap.Modal(modalElement);
            newModal.hide();
          }
        }, 1500);

      } else {
        saveButton.classList.replace('btn-primary', 'btn-danger');
        saveButton.innerHTML = originalText;
        saveButton.disabled = false;
        setTimeout(() => saveButton.classList.replace('btn-danger', 'btn-primary'), 3000);
      }
    })
    .catch((error) => {
      console.error('Error:', error);
      saveButton.classList.replace('btn-primary', 'btn-danger');
      saveButton.innerHTML = originalText;
      saveButton.disabled = false;
      setTimeout(() => saveButton.classList.replace('btn-danger', 'btn-primary'), 3000);
    });
});

// ========================================
// POWER UNIT HANDLERS
// ========================================

/**
 * Update all power displays when unit changes
 * Updates labels and max power display with new unit
 */
function updatePowerDisplays() {
  const unit = PowerUnits.getPowerUnit();
  document.getElementById('power-unit-label').textContent = unit;

  // Update max power display
  if (maxPower > 0) {
    const displayMaxPower = PowerUnits.convertPower(maxPower, unit);
    document.getElementById('max-power').textContent = displayMaxPower.toFixed(2);
    document.getElementById('max-power-rpm').textContent = unit + " @ " + maxPowerRpm.toFixed(0) + " RPM";
  }

  // Refresh chart to update axis labels
  if (uplot) {
    refreshChart();
  }
}

// Listen for power unit changes from power-units.js
window.addEventListener('powerUnitChanged', updatePowerDisplays);

// Listen for storage events from other tabs (cross-tab sync)
window.addEventListener('storage', function (e) {
  if (e.key === 'opendyno_power_unit' && e.newValue) {
    updatePowerDisplays();
  }
});
