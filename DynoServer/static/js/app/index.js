/**
 * Configuration Management for Dyno Test System
 * Handles loading, saving, and managing system configuration
 */

let mode;

const elementMap = {
  launch: {
    startSpeed: "start-speed-input",
    endSpeed: "end-speed-input",
    rampRate: "ramp-rate-input"
  },
  ratio: {
    motorPinions: "motor-pinions-input",
    dynoPinions: "dyno-pinions-input"
  },
  live_graph: {
    torque_min: "live-graph-torque-min-input",
    torque_max: "live-graph-torque-max-input",
    speed_min: "live-graph-speed-min-input",
    speed_max: "live-graph-speed-max-input",
    power_min: "live-graph-power-min-input",
    power_max: "live-graph-power-max-input",
    max_points: "live-graph-max-points-input"
  },
  torque_graph: {
    torque_min: "torque-graph-torque-min-input",
    torque_max: "torque-graph-torque-max-input",
    speed_min: "torque-graph-speed-min-input",
    speed_max: "torque-graph-speed-max-input",
    power_min: "torque-graph-power-min-input",
    power_max: "torque-graph-power-max-input",
    max_points: "torque-graph-max-points-input"
  },
  speed_graph: {
    torque_min: "speed-graph-torque-min-input",
    torque_max: "speed-graph-torque-max-input",
    speed_min: "speed-graph-speed-min-input",
    speed_max: "speed-graph-speed-max-input",
    power_min: "speed-graph-power-min-input",
    power_max: "speed-graph-power-max-input",
    max_points: "speed-graph-max-points-input"
  },
  dynamic_graph: {
    torque_min: "dynamic-graph-torque-min-input",
    torque_max: "dynamic-graph-torque-max-input",
    power_min: "dynamic-graph-power-min-input",
    power_max: "dynamic-graph-power-max-input",
    rpm_min: "dynamic-graph-rpm-min-input",
    rpm_max: "dynamic-graph-rpm-max-input",
    max_points: "dynamic-graph-max-points-input"
  }
};

const specialElements = {
  modeInput: "mode-input",
  modeValueInput: "mode-value-input",
  modeValueRange: "mode-value-range",
  currentModeDisplay: "current-mode"
};

$(document).ready(function () {
  document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(tooltipTriggerEl => {
    new bootstrap.Tooltip(tooltipTriggerEl, { placement: 'right' });
  });

  loadConfiguration();
});

function loadConfiguration() {
  $.getJSON("/api/fastConfig", function (data) {
    populateConfigurationForm(data);
    setupRunMode(data);
    updateChartConfiguration(data);
  });
}

function populateConfigurationForm(data) {
  const motorPinions = parseFloat(data.ratio.motorPinions);
  const dynoPinions = parseFloat(data.ratio.dynoPinions);

  for (const [category, fields] of Object.entries(elementMap)) {
    for (const [field, elementId] of Object.entries(fields)) {
      const element = document.getElementById(elementId);
      if (element && data[category] && data[category][field] !== undefined) {
        if (category === 'launch' && (field === 'startSpeed' || field === 'endSpeed' || field === 'rampRate')) {
          const brakeValue = parseFloat(data[category][field]);
          const motorValue = brakeValue * dynoPinions / motorPinions;
          element.value = Math.round(motorValue);
        } else {
          element.value = data[category][field];
        }
      }
    }
  }

  const displayFilterToggle = document.getElementById('display-filter-toggle');
  if (displayFilterToggle && data.display_filter) {
    displayFilterToggle.checked = data.display_filter.enabled !== false;
    if (window.setDisplayFilterEnabled) {
      window.setDisplayFilterEnabled(displayFilterToggle.checked);
    }
  }

  if (data.launch) {
    const startSpeedDisplay = document.getElementById('current-start-speed');
    const endSpeedDisplay = document.getElementById('current-end-speed');
    const rampRateDisplay = document.getElementById('current-ramp-rate');

    if (startSpeedDisplay && data.launch.startSpeed !== undefined) {
      const val = parseFloat(data.launch.startSpeed) * dynoPinions / motorPinions;
      startSpeedDisplay.textContent = Math.round(val) + ' rpm';
    }
    if (endSpeedDisplay && data.launch.endSpeed !== undefined) {
      const val = parseFloat(data.launch.endSpeed) * dynoPinions / motorPinions;
      endSpeedDisplay.textContent = Math.round(val) + ' rpm';
    }
    if (rampRateDisplay && data.launch.rampRate !== undefined) {
      const val = parseFloat(data.launch.rampRate) * dynoPinions / motorPinions;
      rampRateDisplay.textContent = Math.round(val) + ' RPM/s';
    }
  }
}

function setupRunMode(data) {
  const modeSelect = document.getElementById(specialElements.modeInput);
  const currentModeDisplay = document.getElementById(specialElements.currentModeDisplay);

  modeSelect.innerHTML = "";
  data.runMode.options.forEach(option => {
    const opt = document.createElement("option");
    opt.value = option;
    opt.textContent = option;
    modeSelect.appendChild(opt);
  });

  const serverMode = parseInt(data.runMode.mode);

  if (serverMode === 0) {
    modeSelect.value = "Torque";
    currentModeDisplay.textContent = "Torque mode";
    mode = 0;
  } else if (serverMode === 1) {
    modeSelect.value = "Speed";
    currentModeDisplay.textContent = "Speed mode";
    mode = 1;
  } else if (serverMode === 2) {
    modeSelect.value = "Dynamic";
    currentModeDisplay.textContent = "Dynamic mode";
    mode = 2;
  } else if (serverMode === 3) {
    modeSelect.value = "Dynamic debug";
    currentModeDisplay.textContent = "Dynamic debug mode";
    mode = 3;
  } else {
    modeSelect.value = "Error";
    currentModeDisplay.textContent = "Error";
    mode = -1;
  }

  const modeValueInput = document.getElementById(specialElements.modeValueInput);
  const modeValueRange = document.getElementById(specialElements.modeValueRange);

  if (modeValueInput && data.runMode && data.ratio) {
    const motorValue = DynoUtils.convertBrakeToMotorValue(data.runMode.rawValue, serverMode, data.ratio.motorPinions, data.ratio.dynoPinions);
    modeValueInput.value = motorValue;
    if (modeValueRange) {
      modeValueRange.value = motorValue;
    }
  }

  modeSelect.addEventListener("change", updateModeVisibility);
}

function updateModeVisibility() {
  const modeSelect = document.getElementById(specialElements.modeInput);
  const selectedMode = modeSelect.value;

  const currentModeDisplay = document.getElementById(specialElements.currentModeDisplay);
  if (selectedMode === "Torque") {
    currentModeDisplay.textContent = "Torque mode";
    mode = 0;
  } else if (selectedMode === "Speed") {
    currentModeDisplay.textContent = "Speed mode";
    mode = 1;
  } else if (selectedMode === "Dynamic") {
    currentModeDisplay.textContent = "Dynamic mode";
    mode = 2;
  } else if (selectedMode === "Dynamic debug") {
    currentModeDisplay.textContent = "Dynamic debug mode";
    mode = 3;
  }

  const modeValueInput = document.getElementById(specialElements.modeValueInput);
  const modeValueRange = document.getElementById(specialElements.modeValueRange);
  if (modeValueInput && modeValueRange) {
    modeValueRange.value = modeValueInput.value;
  }
}

function updateChartConfiguration(data) {
  if (window.updateGraphConfigurations) {
    window.updateGraphConfigurations({
      live_graph: data.live_graph,
      speed_graph: data.speed_graph,
      torque_graph: data.torque_graph,
      dynamic_graph: data.dynamic_graph
    });
  }

  if (window.refreshChart) {
    window.refreshChart();
  }
}

document.getElementById('save-graph-config').addEventListener('click', function () {
  const configData = {
    ...DynoUtils.getConfigurationData(elementMap, 'live_graph'),
    ...DynoUtils.getConfigurationData(elementMap, 'speed_graph'),
    ...DynoUtils.getConfigurationData(elementMap, 'torque_graph'),
    ...DynoUtils.getConfigurationData(elementMap, 'dynamic_graph')
  };

  const displayFilterToggle = document.getElementById('display-filter-toggle');
  if (displayFilterToggle) {
    configData.display_filter = { enabled: displayFilterToggle.checked };
  }

  if (window.updateGraphConfigurations) {
    window.updateGraphConfigurations(configData);
  }

  if (window.refreshChart) {
    window.refreshChart();
  }

  DynoUtils.sendConfig('/api/fastConfig', configData, this.id);
});

document.getElementById('display-filter-toggle').addEventListener('change', function () {
  if (window.setDisplayFilterEnabled) {
    window.setDisplayFilterEnabled(this.checked);
  }
  const configData = { display_filter: { enabled: this.checked } };
  DynoUtils.sendConfig('/api/fastConfig', configData, null);
});

document.getElementById('save-dyno-config').addEventListener('click', function () {
  const config = DynoUtils.getConfigurationData(elementMap, 'launch');

  const motorPinions = parseFloat(document.getElementById(elementMap.ratio.motorPinions).value);
  const dynoPinions = parseFloat(document.getElementById(elementMap.ratio.dynoPinions).value);

  if (config.launch.startSpeed) {
    config.launch.startSpeed = parseFloat(config.launch.startSpeed) * motorPinions / dynoPinions;
  }
  if (config.launch.endSpeed) {
    config.launch.endSpeed = parseFloat(config.launch.endSpeed) * motorPinions / dynoPinions;
  }
  if (config.launch.rampRate) {
    config.launch.rampRate = parseFloat(config.launch.rampRate) * motorPinions / dynoPinions;
  }

  DynoUtils.sendConfig('/api/fastConfig', config, this.id);
});

document.getElementById('save-motor-ratio').addEventListener('click', function () {
  const config = DynoUtils.getConfigurationData(elementMap, 'ratio');
  DynoUtils.sendConfig('/api/fastConfig', config, this.id);
});

document.getElementById('save-run-mode').addEventListener('click', function () {
  const modeSelect = document.getElementById(specialElements.modeInput);
  const runModeValueInput = document.getElementById(specialElements.modeValueInput);
  const currentModeDisplay = document.getElementById(specialElements.currentModeDisplay);

  if (!modeSelect || !runModeValueInput) return;

  const runModeInputText = modeSelect.value;
  const numericMode = DynoUtils.getNumericMode(runModeInputText);
  const motorValue = parseInt(runModeValueInput.value, 10);

  const motorPinions = parseFloat(document.getElementById(elementMap.ratio.motorPinions).value);
  const dynoPinions = parseFloat(document.getElementById(elementMap.ratio.dynoPinions).value);
  const brakeValues = DynoUtils.convertMotorToBrakeValue(motorValue, numericMode, motorPinions, dynoPinions);

  if (runModeInputText === "Torque") {
    currentModeDisplay.textContent = "Torque mode";
  } else if (runModeInputText === "Speed") {
    currentModeDisplay.textContent = "Speed mode";
  } else if (runModeInputText === "Dynamic") {
    currentModeDisplay.textContent = "Dynamic mode";
  } else if (runModeInputText === "Dynamic debug") {
    currentModeDisplay.textContent = "Dynamic debug mode";
  }

  const config = {
    "runMode": {
      "options": ["Dynamic", "Torque", "Speed", "Dynamic debug"],
      "mode": numericMode.toString(),
      "value": brakeValues.value,
      "rawValue": brakeValues.rawValue
    }
  };

  DynoUtils.sendConfig('/api/fastConfig', config, this.id);
});

function updateButtonState(running) {
  const runTestButton = document.getElementById('run-test');
  if (!runTestButton) return;

  if (running) {
    runTestButton.classList.remove('btn-success');
    runTestButton.classList.add('btn-danger');
    runTestButton.innerHTML = '<i class="bi bi-stop-fill"></i> Stop';
  } else {
    runTestButton.classList.remove('btn-danger');
    runTestButton.classList.add('btn-success');
    runTestButton.innerHTML = '<i class="bi bi-play-fill"></i> Run';
  }
}

function showAlert(message) {
  DynoUtils.showAlert(message, 'danger');
}

fetch('/api/status')
  .then(res => res.json())
  .then(data => {
    const isRunning = data.status === 'Running';
    window.isRunning = isRunning;
    updateButtonState(isRunning);
  })
  .catch(() => {});

const valueInput = document.getElementById(specialElements.modeValueInput);
const valueRange = document.getElementById(specialElements.modeValueRange);

if (valueInput && valueRange) {
  valueInput.addEventListener('input', () => {
    valueRange.value = valueInput.value;
  });

  valueRange.addEventListener('input', () => {
    valueInput.value = valueRange.value;
  });
}

document.addEventListener('DOMContentLoaded', function () {
  const graphConfigButton = document.getElementById('graphConfigButton');
  const graphConfigModal = document.getElementById('graphConfigModal');

  if (graphConfigButton && graphConfigModal) {
    graphConfigModal.addEventListener('show.bs.modal', function () {
      graphConfigButton.classList.remove('collapsed');
      graphConfigButton.classList.add('active');
      graphConfigButton.setAttribute('aria-expanded', 'true');
    });

    graphConfigModal.addEventListener('hidden.bs.modal', function () {
      graphConfigButton.classList.add('collapsed');
      graphConfigButton.classList.remove('active');
      graphConfigButton.setAttribute('aria-expanded', 'false');
    });
  }
});

document.addEventListener('DOMContentLoaded', function () {
  const btn = document.getElementById('sidebar-toggle-btn');
  const status = document.getElementById('sidebar-status');
  const icon = document.getElementById('sidebar-toggle-icon');
  const STORAGE_KEY = 'dyno_sidebar_status_collapsed';

  if (!btn || !status || !icon) {
    return;
  }

  function setExpanded(exp) {
    if (exp) {
      status.classList.remove('collapsed');
      icon.classList.remove('bi-chevron-up');
      icon.classList.add('bi-chevron-down');
      btn.setAttribute('aria-expanded', 'true');
    } else {
      status.classList.add('collapsed');
      icon.classList.remove('bi-chevron-down');
      icon.classList.add('bi-chevron-up');
      btn.setAttribute('aria-expanded', 'false');
    }
  }

  const stored = localStorage.getItem(STORAGE_KEY);
  const defaultCollapsed = window.innerWidth < 768;
  const collapsed = stored === null ? defaultCollapsed : stored === 'true';

  setExpanded(!collapsed);

  btn.addEventListener('click', function () {
    const isCollapsed = status.classList.contains('collapsed');
    setExpanded(isCollapsed);
    localStorage.setItem(STORAGE_KEY, String(!isCollapsed));
  });

  window.dynoStatus = {
    set: function (id, value) {
      try {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
      } catch (e) { /* ignore */ }
    },
    updateAll: function (obj) {
      if (!obj || typeof obj !== 'object') return;
      Object.keys(obj).forEach(function (k) {
        const el = document.getElementById(k);
        if (el) el.textContent = obj[k];
      });
    }
  };
});

socket.on('debug_data', function (data) {
  if ('setpoint' in data) {
    document.getElementById('pwm-value').textContent = parseFloat(data.pwm).toFixed(2) + ' %';
  }
});
