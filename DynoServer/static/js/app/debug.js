/**
 * debug.js - Debug Configuration Management for Dyno Test System
 * Handles loading, saving, and managing debug configuration
 */

let currentModeValue = "Dynamic debug";
let previousMode = 3;

const elementMap = {
    torquePID: {
        kp: "torqueKpInput",
        ki: "torqueKiInput",
        kd: "torqueKdInput"
    },
    speedPID: {
        kp: "speedKpInput",
        ki: "speedKiInput",
        kd: "speedKdInput"
    },
    dynamicPID: {
        kp: "dynamicKpInput",
        ki: "dynamicKiInput",
        kd: "dynamicKdInput"
    },
    loadCell: {
        gain: "loadCellGain",
        scale: "loadCellScale",
        offset: "loadCellOffset",
        distance: "loadCellDistance"
    },
    debug_graph: {
        max_points: "maxPointsInput",
        torque_min: "minTorqueInput",
        torque_max: "maxTorqueInput",
        speed_min: "minSpeedInput",
        speed_max: "maxSpeedInput",
        pwm_min: "minPwmInput",
        pwm_max: "maxPwmInput",
        acc_min: "minAccInput",
        acc_max: "maxAccInput"
    }
};

const specialElements = {
    modeInput: "modeInput",
    runModeValueInput: "runModeValueInput",
    modeValueRange: "modeValueRange",
    modeValueHelp: "modeValueHelp",
    pwmValue: "pwm-value",
    runTestButton: "run-test",
    alertBox: "run-alert",
    tareButton: "tare-load-cell"
};

$(document).ready(function () {
    loadConfiguration();
});

function loadConfiguration() {
    $.getJSON("/api/config", function (data) {
        populateConfigurationForm(data);
        setupRunMode(data);
        updateChartConfiguration(data);
    });
}

function populateConfigurationForm(data) {
    window.gearRatios = {
        dynoPinions: data.ratio.dynoPinions,
        motorPinions: data.ratio.motorPinions,
        armDistance: data.loadCell.distance
    };

    for (const [category, fields] of Object.entries(elementMap)) {
        for (const [field, elementId] of Object.entries(fields)) {
            const element = document.getElementById(elementId);
            if (element && data[category] && data[category][field] !== undefined) {
                element.value = data[category][field];
            }
        }
    }

    const runModeValueInput = document.getElementById(specialElements.runModeValueInput);
    if (runModeValueInput && data.runMode && window.gearRatios) {
        const serverMode = parseInt(data.runMode.mode);
        const motorValue = DynoUtils.convertBrakeToMotorValue(data.runMode.rawValue, serverMode, window.gearRatios.motorPinions, window.gearRatios.dynoPinions);
        runModeValueInput.value = motorValue;

        const modeValueRange = document.getElementById(specialElements.modeValueRange);
        if (modeValueRange) {
            modeValueRange.value = motorValue;
        }
    }
}

function setupRunMode(data) {
    const modeSelect = document.getElementById(specialElements.modeInput);

    if (!modeSelect) return;

    modeSelect.innerHTML = "";
    data.runMode.options.forEach(option => {
        let opt = document.createElement("option");
        opt.value = option;
        opt.textContent = option;
        modeSelect.appendChild(opt);
    });

    previousMode = parseInt(data.runMode.mode);

    if (previousMode === 0) {
        currentModeValue = "Torque";
        modeSelect.value = "Torque";
    } else if (previousMode === 1) {
        currentModeValue = "Speed";
        modeSelect.value = "Speed";
    } else if (previousMode === 2) {
        currentModeValue = "Dynamic";
        modeSelect.value = "Dynamic";
    } else if (previousMode === 3) {
        currentModeValue = "Dynamic debug";
        modeSelect.value = "Dynamic debug";
    } else {
        currentModeValue = "Speed";
        modeSelect.value = "Error";
    }

    modeSelect.addEventListener("change", updateModeVisibility);
    updateModeVisibility();

    if (window.updateChartMode) {
        window.updateChartMode(currentModeValue);
    }
}

function updateModeVisibility() {
    const modeSelect = document.getElementById(specialElements.modeInput);
    const modeValueInput = document.getElementById(specialElements.runModeValueInput);
    const modeValueHelp = document.getElementById(specialElements.modeValueHelp);
    const modeValueRange = document.getElementById(specialElements.modeValueRange);

    if (!modeSelect || !modeValueInput || !modeValueHelp) return;

    let selectedMode = modeSelect.value;

    if (selectedMode === "Torque") {
        modeValueHelp.textContent = "Motor Torque (Nm)";
        modeValueInput.placeholder = "Enter motor torque in Nm";
    } else if (selectedMode === "Speed") {
        modeValueHelp.textContent = "Motor Speed (RPM)";
        modeValueInput.placeholder = "Enter motor speed in RPM";
    } else if (selectedMode === "Dynamic" || selectedMode === "Dynamic debug") {
        modeValueHelp.textContent = "Motor Acceleration (RPM/s)";
        modeValueInput.placeholder = "Enter motor acceleration in RPM/s";
    }

    modeValueInput.disabled = false;
    if (modeValueRange) {
        modeValueRange.disabled = false;
    }
}

function updateChartConfiguration(data) {
    if (window.updateChartParameters) {
        window.updateChartParameters({
            MIN_TORQUE: Number(data.debug_graph.torque_min),
            MAX_TORQUE: Number(data.debug_graph.torque_max),
            MIN_SPEED: Number(data.debug_graph.speed_min),
            MAX_SPEED: Number(data.debug_graph.speed_max),
            MIN_PWM: Number(data.debug_graph.pwm_min),
            MAX_PWM: Number(data.debug_graph.pwm_max),
            MAX_POINTS: Number(data.debug_graph.max_points),
            MIN_ACC: Number(data.debug_graph.acc_min),
            MAX_ACC: Number(data.debug_graph.acc_max)
        });
    }

    if (window.refreshChart) {
        window.refreshChart();
    }
}

function saveRunMode(id) {
    const modeSelect = document.getElementById(specialElements.modeInput);
    const runModeValueInput = document.getElementById(specialElements.runModeValueInput);

    if (!modeSelect || !runModeValueInput) return;

    const runModeInputText = modeSelect.value;
    const runModeInput = DynoUtils.getNumericMode(runModeInputText);

    if (previousMode !== runModeInput) {
        if (window.updateChartMode) {
            window.updateChartMode(runModeInputText);
            previousMode = runModeInput;
        }
    }

    const motorValue = parseInt(runModeValueInput.value, 10);

    const brakeValues = DynoUtils.convertMotorToBrakeValue(
        motorValue,
        runModeInput,
        window.gearRatios.motorPinions,
        window.gearRatios.dynoPinions
    );

    const config = {
        "runMode": {
            "options": ["Dynamic", "Torque", "Speed", "Dynamic debug"],
            "mode": runModeInput.toString(),
            "value": brakeValues.value,
            "rawValue": brakeValues.rawValue
        }
    };

    DynoUtils.sendConfig('/api/fastConfig', config, id);
}

const runTestButton = document.getElementById(specialElements.runTestButton);
const alertBox = document.getElementById(specialElements.alertBox);
let isRunning = false;

function updateButtonState(running) {
    isRunning = running;

    if (isRunning) {
        runTestButton.classList.remove('btn-success');
        runTestButton.classList.add('btn-danger');
        runTestButton.innerHTML = '<i class="bi bi-stop-fill"></i> Stop test';
    } else {
        runTestButton.classList.remove('btn-danger');
        runTestButton.classList.add('btn-success');
        runTestButton.innerHTML = '<i class="bi bi-play-fill"></i> Run test';
    }
}

function showAlert(message) {
    if (alertBox) {
        alertBox.innerHTML = `<div class="alert alert-danger mb-0 py-1">${message}</div>`;
    }
}

fetch('/api/status')
    .then(res => res.json())
    .then(data => {
        if (data.status === 'Running') {
            updateButtonState(true);
        } else {
            updateButtonState(false);
        }
        const pwmValueInput = document.getElementById(specialElements.pwmValue);
        if (pwmValueInput) {
            pwmValueInput.value = data.pwm_value;
        }
    })
    .catch(() => showAlert('Failed to get initial status.'));

if (runTestButton) {
    runTestButton.addEventListener('click', function () {
        const url = isRunning ? '/api/stop' : '/api/run';

        fetch(url)
            .then(res => res.json())
            .then(data => {
                if (data.message === 'success') {
                    updateButtonState(!isRunning);
                    if (alertBox) {
                        alertBox.innerHTML = '';
                    }
                } else {
                    showAlert('Error: Action failed.');
                }
            })
            .catch(() => {
                showAlert('Network error.');
            });
    });
}

const valueInput = document.getElementById(specialElements.runModeValueInput);
const valueRange = document.getElementById(specialElements.modeValueRange);

if (valueInput && valueRange) {
    valueInput.addEventListener('input', () => {
        valueRange.value = valueInput.value;
    });

    valueRange.addEventListener('input', () => {
        valueInput.value = valueRange.value;
    });
}

document.getElementById('save-torque-pid-config')?.addEventListener('click', function () {
    const config = DynoUtils.getConfigurationData(elementMap, 'torquePID');
    DynoUtils.sendConfig('/api/fastConfig', config, this.id);
});

document.getElementById('save-speed-pid-config')?.addEventListener('click', function () {
    const config = DynoUtils.getConfigurationData(elementMap, 'speedPID');
    DynoUtils.sendConfig('/api/fastConfig', config, this.id);
});

document.getElementById('save-dynamic-pid-config')?.addEventListener('click', function () {
    const config = DynoUtils.getConfigurationData(elementMap, 'dynamicPID');
    DynoUtils.sendConfig('/api/fastConfig', config, this.id);
});

document.getElementById('save-load-cell-config')?.addEventListener('click', function () {
    const config = DynoUtils.getConfigurationData(elementMap, 'loadCell');
    DynoUtils.sendConfig('/api/fastConfig', config, this.id);
});

document.getElementById('save-graph-config')?.addEventListener('click', function () {
    const config = DynoUtils.getConfigurationData(elementMap, 'debug_graph');
    DynoUtils.sendConfig('/api/fastConfig', config, this.id);

    if (window.updateChartParameters) {
        const configData = config.debug_graph;
        window.updateChartParameters({
            MIN_TORQUE: Number(configData.torque_min),
            MAX_TORQUE: Number(configData.torque_max),
            MIN_SPEED: Number(configData.speed_min),
            MAX_SPEED: Number(configData.speed_max),
            MIN_PWM: Number(configData.pwm_min),
            MAX_PWM: Number(configData.pwm_max),
            MAX_POINTS: Number(configData.max_points),
            MIN_ACC: Number(configData.acc_min),
            MAX_ACC: Number(configData.acc_max)
        });
    }

    if (window.refreshChart) {
        window.refreshChart();
    }
});

document.getElementById('save-run-mode')?.addEventListener('click', function () {
    saveRunMode(this.id);
});

document.getElementById('save-pwm-config')?.addEventListener('click', function () {
    const pwmValueInput = document.getElementById(specialElements.pwmValue);
    if (!pwmValueInput) return;

    const pwm_value = pwmValueInput.value;
    const config = { "pwm_value": pwm_value };

    fetch('/api/update_pwm', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(config)
    })
        .then(response => response.json())
        .then(data => {
            const button = document.getElementById('save-pwm-config');
            if (data.message === 'success') {
                DynoUtils.successSavedConfiguration(button, button.innerHTML);
            } else if (data.message === 'error') {
                DynoUtils.errorSavingConfiguration(button, button.innerHTML);
            }
        })
        .catch(error => {
            console.error('Error:', error);
            const button = document.getElementById('save-pwm-config');
            DynoUtils.errorSavingConfiguration(button, button.innerHTML);
        });
});

document.getElementById(specialElements.tareButton)?.addEventListener('click', function () {
    $.getJSON("/api/tare", function (data) {
        const button = document.getElementById(specialElements.tareButton);
        if (data.message == 'success') {
            DynoUtils.successSavedConfiguration(button, button.innerHTML);
        } else {
            DynoUtils.errorSavingConfiguration(button, button.innerHTML);
        }
    });
});

let saveTimeout;
if (valueRange) {
    valueRange.addEventListener('input', function () {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => saveRunMode(), 200);
    });

    valueRange.addEventListener('change', function () {
        saveRunMode();
    });
}
