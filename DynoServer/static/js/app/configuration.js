/**
 * configuration.js - Configuration page management
 */

$(document).ready(function () {
    // Initialize Bootstrap tooltips with right placement
    document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(tooltipTriggerEl => {
        new bootstrap.Tooltip(tooltipTriggerEl, { placement: 'right' });
    });

    // ========================================
    // ELEMENT MAPPING
    // Maps config JSON fields to HTML element IDs
    // ========================================
    const elementMap = {
        // Run configuration
        launch: {
            startSpeed: "start-speed-input",
            stableTime: "stable-time-input",
            endSpeed: "end-speed-input",
            rampRate: "ramp-rate-input",
            endHoldDelay: "end-hold-delay-input",
            rampDownRate: "ramp-down-rate-input",
            finalSpeed: "final-speed-input"
        },
        // Speed limits
        speedLimits: {
            maxSpeed: "max-speed-input",
            minSpeed: "min-speed-input"
        },
        // Load cell
        loadCell: {
            gain: "load-cell-gain-input",
            scale: "load-cell-scale-input",
            offset: "load-cell-offset-input",
            distance: "load-cell-distance-input"
        },
        // Inertia
        inertiaAndLoads: {
            dynoInertia: "dyno-inertia-input",
            chainInertia: "chain-inertia-input",
            fanInertia: "fan-load-input"
        },
        // Torque PID
        torquePID: {
            kp: "torque-kp-input",
            ki: "torque-ki-input",
            kd: "torque-kd-input"
        },
        // Speed PID
        speedPID: {
            kp: "speed-kp-input",
            ki: "speed-ki-input",
            kd: "speed-kd-input"
        },
        // Dynamic PID
        dynamicPID: {
            kp: "dynamic-kp-input",
            ki: "dynamic-ki-input",
            kd: "dynamic-kd-input"
        },
        // Motor ratio
        ratio: {
            motorPinions: "motor-ratio-input",
            dynoPinions: "dyno-ratio-input"
        },
        // PWM
        pwm: {
            start: "pwm-start-input",
            limit: "pwm-limit-input",
            frequency: "pwm-frequency-input"
        },
        // Low pass filters
        low_pass_filters: {
            speed: "speed-low-pass-filter-input",
            torque: "torque-low-pass-filter-input",
            acceleration: "acc-low-pass-filter-input",
            output: "output-low-pass-filter-input"
        },
        // Live graph
        live_graph: {
            max_points: "live-graph-max-points-input",
            torque_min: "live-graph-torque-min-input",
            torque_max: "live-graph-torque-max-input",
            speed_min: "live-graph-speed-min-input",
            speed_max: "live-graph-speed-max-input",
            power_min: "live-graph-power-min-input",
            power_max: "live-graph-power-max-input"
        },
        // Speed graph
        speed_graph: {
            max_points: "speed-graph-max-points-input",
            torque_min: "speed-graph-torque-min-input",
            torque_max: "speed-graph-torque-max-input",
            speed_min: "speed-graph-speed-min-input",
            speed_max: "speed-graph-speed-max-input",
            power_min: "speed-graph-power-min-input",
            power_max: "speed-graph-power-max-input"
        },
        // Torque graph
        torque_graph: {
            max_points: "torque-graph-max-points-input",
            torque_min: "torque-graph-torque-min-input",
            torque_max: "torque-graph-torque-max-input",
            speed_min: "torque-graph-speed-min-input",
            speed_max: "torque-graph-speed-max-input",
            power_min: "torque-graph-power-min-input",
            power_max: "torque-graph-power-max-input"
        },
        // Dynamic graph
        dynamic_graph: {
            max_points: "dynamic-graph-max-points-input",
            torque_min: "dynamic-graph-torque-min-input",
            torque_max: "dynamic-graph-torque-max-input",
            power_min: "dynamic-graph-power-min-input",
            power_max: "dynamic-graph-power-max-input",
            rpm_min: "dynamic-graph-rpm-min-input",
            rpm_max: "dynamic-graph-rpm-max-input"
        },
        // Debug graph
        debug_graph: {
            pwm_max: "debug-graph-max-pwm-input",
            pwm_min: "debug-graph-min-pwm-input",
            torque_max: "debug-graph-max-torque-input",
            torque_min: "debug-graph-min-torque-input",
            speed_max: "debug-graph-max-speed-input",
            speed_min: "debug-graph-min-speed-input",
            max_points: "debug-graph-max-points-input",
            acc_min: "debug-graph-min-acc-input",
            acc_max: "debug-graph-max-acc-input"
        },
        // CAN Interface
        canInterface: {
            mode: "can-mode-input",
            channel: "can-channel-input",
            bitrate: "can-bitrate-input"
        }
    };

    // ========================================
    // CONFIGURATION LOADING
    // ========================================

    // Utility functions moved to DynoUtils in utils.js

    /**
     * Populate form fields with configuration data from server
     * Handles motor/brake conversions for launch parameters
     */
    function setValuesFromData(data) {
        // First get the gear ratio values
        const motorPinions = parseFloat(data.ratio.motorPinions);
        const dynoPinions = parseFloat(data.ratio.dynoPinions);

        // Set values for all mapped elements
        for (const [category, fields] of Object.entries(elementMap)) {
            for (const [field, elementId] of Object.entries(fields)) {
                const element = document.getElementById(elementId);
                if (element && data[category] && data[category][field] !== undefined) {
                    // Convert launch parameters from brake to motor
                    if (category === 'launch') {
                        const brakeValue = parseFloat(data[category][field]);
                        let motorValue;

                        // All launch parameters are speeds or acceleration rates
                        // startSpeed, endSpeed, finalSpeed are speeds (rpm)
                        // rampRate, rampDownRate are acceleration rates (rpm/s)
                        if (field === 'startSpeed' || field === 'endSpeed' || field === 'finalSpeed') {
                            // Convert brake speed to motor speed (Mode 1: Speed)
                            motorValue = DynoUtils.convertBrakeToMotorValue(brakeValue, 1, motorPinions, dynoPinions);
                        } else if (field === 'rampRate' || field === 'rampDownRate') {
                            // Convert brake acceleration to motor acceleration (Mode 2: Dynamic)
                            motorValue = DynoUtils.convertBrakeToMotorValue(brakeValue, 2, motorPinions, dynoPinions);
                        } else {
                            // stableTime and endHoldDelay don't need conversion
                            motorValue = brakeValue;
                        }

                        element.value = Math.round(motorValue);
                    } else {
                        // For other categories, set directly
                        element.value = data[category][field];
                    }
                }
            }
        }

        // Handle special cases (non-input elements)
        const debugCheckbox = document.getElementById("debug-check");
        if (debugCheckbox && data.debug !== undefined) {
            debugCheckbox.checked = data.debug.enabled;
        }

        // Run mode handling (special logic)
        const modeSelect = document.getElementById("run-mode-input");
        const modeValueInput = document.getElementById("run-mode-value-input");
        const modeValueHelp = document.getElementById("runModeValueHelp");

        // Convert brake value from server to motor value for display
        if (modeValueInput && data.runMode && data.ratio) {
            const numericMode = parseInt(data.runMode.mode);
            const motorValue = DynoUtils.convertBrakeToMotorValue(
                data.runMode.rawValue,
                numericMode,
                motorPinions,
                dynoPinions
            );
            modeValueInput.value = motorValue;
        }

        // Fill run modes select
        if (modeSelect && data.runMode) {
            modeSelect.innerHTML = "";
            data.runMode.options.forEach(option => {
                let opt = document.createElement("option");
                opt.value = option;
                opt.textContent = option;
                modeSelect.appendChild(opt);
            });

            // Set current mode
            const serverMode = parseInt(data.runMode.mode);
            if (serverMode === 0) {
                modeSelect.value = "Torque";
            } else if (serverMode === 1) {
                modeSelect.value = "Speed";
            } else if (serverMode === 2) {
                modeSelect.value = "Dynamic";
            } else if (serverMode === 3) {
                modeSelect.value = "Dynamic debug";
            } else {
                modeSelect.value = "Error";
            }
        }

        // Hide/show value input based on mode and update help text
        function updateModeVisibility() {
            if (modeSelect && modeValueInput && modeValueHelp) {
                let selectedMode = modeSelect.value;

                // Update help text and units
                if (selectedMode === "Torque") {
                    modeValueHelp.textContent = "Motor Torque (Nm)";
                    modeValueInput.disabled = false;
                    modeValueInput.placeholder = "Enter motor torque in Nm";
                } else if (selectedMode === "Speed") {
                    modeValueHelp.textContent = "Motor Speed (RPM)";
                    modeValueInput.disabled = false;
                    modeValueInput.placeholder = "Enter motor speed in RPM";
                } else if (selectedMode === "Dynamic" || selectedMode === "Dynamic debug") {
                    modeValueHelp.textContent = "Motor Acceleration (RPM/s)";
                    modeValueInput.disabled = false;
                    modeValueInput.placeholder = "Enter motor acceleration in RPM/s";
                }
            }
        }

        if (modeSelect) {
            modeSelect.addEventListener('change', updateModeVisibility);
            updateModeVisibility(); // Initial call
        }
    }

    // ========================================
    // CONFIGURATION SAVING
    // ========================================

    /**
     * Collect form values for saving to server
     */
    function getValuesForSave() {
        const values = {};

        // Get values for all mapped elements
        for (const [category, fields] of Object.entries(elementMap)) {
            values[category] = {};
            for (const [field, elementId] of Object.entries(fields)) {
                const element = document.getElementById(elementId);
                if (element) {
                    values[category][field] = element.value;
                }
            }
        }

        return values;
    }

    // ========================================
    // INITIALIZATION
    // ========================================

    // CAN Interfaces
    let availableInterfaces = { native: [], serial: [] };

    function populateCANInterfaces(selectedMode, selectedChannel) {
        const select = document.getElementById("can-channel-input");
        if (!select) return;
        
        select.innerHTML = '';
        const options = selectedMode === 'native' ? availableInterfaces.native : availableInterfaces.serial;
        
        if (options.length === 0) {
            let opt = document.createElement("option");
            opt.value = "";
            opt.textContent = "No interfaces found";
            select.appendChild(opt);
            return;
        }
        
        options.forEach(interfaceName => {
            let opt = document.createElement("option");
            opt.value = interfaceName;
            opt.textContent = interfaceName;
            if (interfaceName === selectedChannel) {
                opt.selected = true;
            }
            select.appendChild(opt);
        });

        // Ensure current saved channel stays visible if it's not in the list
        if (selectedChannel && !options.includes(selectedChannel)) {
            let opt = document.createElement("option");
            opt.value = selectedChannel;
            opt.textContent = selectedChannel + " (Not found)";
            opt.selected = true;
            select.appendChild(opt);
        }
    }

    // Load available CAN interfaces
    $.getJSON("/api/can/interfaces", function(data) {
        availableInterfaces = data;
        
        // Load configuration on page load
        $.getJSON("/api/config", function (configData) {
            setValuesFromData(configData);
            
            // Set up listener for CAN mode change
            const canModeSelect = document.getElementById("can-mode-input");
            if (canModeSelect) {
                const currentChannel = configData.canInterface ? configData.canInterface.channel : '';
                populateCANInterfaces(canModeSelect.value, currentChannel);
                
                canModeSelect.addEventListener('change', function() {
                    populateCANInterfaces(this.value, null);
                });
            }
        });
    });

    // ========================================
    // SAVE BUTTON HANDLER
    // ========================================
    document.getElementById('save-config-btn').addEventListener('click', function () {
        const values = getValuesForSave();

        // Get special case values
        const runModeValueInput = document.getElementById('run-mode-value-input');
        const modeSelect = document.getElementById('run-mode-input');
        const debugCheckbox = document.getElementById('debug-check');

        // Initialize configData variable
        let configData;

        // Get gear ratio values for conversion
        const motorPinions = parseFloat(values.ratio.motorPinions);
        const dynoPinions = parseFloat(values.ratio.dynoPinions);

        // Handle run mode conversion
        if (modeSelect) {
            const modeInputText = modeSelect.value;
            const motorValue = parseFloat(runModeValueInput.value);
            const numericMode = DynoUtils.getNumericMode(modeInputText);

            const brakeValues = DynoUtils.convertMotorToBrakeValue(
                motorValue,
                numericMode,
                motorPinions,
                dynoPinions
            );

            // Convert launch parameters from motor to brake for storage
            const launchBrakeValues = {};
            for (const [field, motorValue] of Object.entries(values.launch)) {
                const floatValue = parseFloat(motorValue);

                if (field === 'startSpeed' || field === 'endSpeed' || field === 'finalSpeed') {
                    // Convert motor speed to brake speed (Mode 1)
                    launchBrakeValues[field] = DynoUtils.convertMotorToBrakeValue(floatValue, 1, motorPinions, dynoPinions).rawValue;
                } else if (field === 'rampRate' || field === 'rampDownRate') {
                    // Convert motor acceleration to brake acceleration (Mode 2)
                    launchBrakeValues[field] = DynoUtils.convertMotorToBrakeValue(floatValue, 2, motorPinions, dynoPinions).rawValue;
                } else {
                    // stableTime and endHoldDelay don't need conversion
                    launchBrakeValues[field] = floatValue;
                }
            }

            // Build final config data with proper conversions
            configData = {
                ...values,
                launch: launchBrakeValues,
                runMode: {
                    options: ["Dynamic", "Torque", "Speed", "Dynamic debug"],
                    mode: numericMode.toString(),
                    value: brakeValues.value,
                    rawValue: brakeValues.rawValue
                },
                debug: {
                    enabled: debugCheckbox ? debugCheckbox.checked : false
                }
            };
        } else {
            const launchBrakeValues = {};
            for (const [field, motorValue] of Object.entries(values.launch)) {
                const floatValue = parseFloat(motorValue);

                if (field === 'startSpeed' || field === 'endSpeed' || field === 'finalSpeed') {
                    launchBrakeValues[field] = DynoUtils.convertMotorToBrakeValue(floatValue, 1, motorPinions, dynoPinions).rawValue;
                } else if (field === 'rampRate' || field === 'rampDownRate') {
                    launchBrakeValues[field] = DynoUtils.convertMotorToBrakeValue(floatValue, 2, motorPinions, dynoPinions).rawValue;
                } else {
                    launchBrakeValues[field] = floatValue;
                }
            }

            configData = {
                ...values,
                launch: launchBrakeValues,
                runMode: {
                    options: ["Dynamic", "Torque", "Speed", "Dynamic debug"],
                    mode: "1",
                    value: Math.round(parseFloat(runModeValueInput.value) * motorPinions / dynoPinions),
                    rawValue: parseFloat(runModeValueInput.value) * motorPinions / dynoPinions
                },
                debug: {
                    enabled: debugCheckbox ? debugCheckbox.checked : false
                }
            };
        }

        // Send JSON
        fetch('/api/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(configData)
        })
            .then(response => response.json())
            .then(data => {
                if (data.message === 'success') {
                    DynoUtils.showAlert('Configuration saved!', 'success');
                } else if (data.message === 'error') {
                    DynoUtils.showAlert('Error saving configuration', 'danger');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                DynoUtils.showAlert('An unexpected error occurred.', 'danger');
            });

        // Update debug link visibility
        fetch('/api/status')
            .then(response => response.json())
            .then(config => {
                const debugLink = document.getElementById('debug-link');
                if (debugLink) {
                    debugLink.style.display = config.debug === true ? 'block' : 'none';
                }
            })
            .catch(err => {
                console.error("Failed to load config:", err);
            });
    });

    // ========================================
    // RECONNECT CAN BUTTON HANDLER
    // ========================================
    const reconnectBtn = document.getElementById('reconnect-can-btn');
    if (reconnectBtn) {
        reconnectBtn.addEventListener('click', function() {
            // First save the config
            document.getElementById('save-config-btn').click();
            
            // Then wait a brief moment and trigger reconnect
            setTimeout(() => {
                fetch('/api/can/reconnect', {
                    method: 'POST'
                })
                .then(response => response.json())
                .then(data => {
                    if (data.message === 'success') {
                        DynoUtils.showAlert('CAN interface reconnected successfully!', 'success');
                    } else {
                        DynoUtils.showAlert('Failed to reconnect CAN interface', 'danger');
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                    DynoUtils.showAlert('An unexpected error occurred during reconnect.', 'danger');
                });
            }, 1000); // Wait 1s for the config save to complete
        });
    }

    // appendAlert moved to DynoUtils.showAlert
});