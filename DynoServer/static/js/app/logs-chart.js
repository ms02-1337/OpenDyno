/**
 * logs-chart.js - Test log viewing and comparison
 */

// ========================================
// CHART STATE
// ========================================

let apexChart;
let selectedLogs = [];
let isComparisonMode = false;
let currentLogData1 = null;
let currentLogData2 = null;
let logsDisplayFilterEnabled = true;

const LOG_COLORS = [
    ['#000000', '#FF0000', '#4ECDC4'], // Log 1: Power=Black, Torque=Red, RPM=Teal
    ['#28a745', '#007bff', '#6f42c1']  // Log 2: Power=Green, Torque=Blue, RPM=Purple
];

class LogsCascadedIIRFilter {
    constructor(stages, cutoffHz, sampleRateHz) {
        this.stages = stages;
        const tau = 1.0 / (2 * Math.PI * cutoffHz);
        const dt = 1.0 / sampleRateHz;
        this.alpha = Math.exp(-dt / tau);
    }

    filterArray(values) {
        const prev = new Array(this.stages).fill(null);
        return values.map(value => {
            let output = value;
            for (let i = 0; i < this.stages; i++) {
                if (prev[i] === null) {
                    prev[i] = output;
                    continue;
                }
                prev[i] = this.alpha * prev[i] + (1 - this.alpha) * output;
                output = prev[i];
            }
            return output;
        });
    }
}

function getLogDisplayFilterToggle() {
    return document.getElementById('log-display-filter-toggle');
}

function applyLogDisplayFilter(data) {
    if (!logsDisplayFilterEnabled || !data || !data.data || data.data.length === 0) return data;

    const sampleRate = 100;
    const filter = new LogsCascadedIIRFilter(2, 2, sampleRate);
    const rawTorque = data.data.map(entry => entry.torque);
    const filteredTorque = filter.filterArray(rawTorque);

    const filtered = JSON.parse(JSON.stringify(data));
    for (let i = 0; i < filtered.data.length; i++) {
        filtered.data[i].torque = filteredTorque[i];
        filtered.data[i].power = (filtered.data[i].torque * filtered.data[i].rpm * 2 * Math.PI) / 60000;
    }
    return filtered;
}

// ========================================
// POWER UNIT HELPERS
// ========================================

/**
 * Get current power unit label
 */
function getPowerUnitLabel() {
    return PowerUnits.getPowerUnit();
}

function formatPowerValue(valueKW) {
    const unit = PowerUnits.getPowerUnit();
    const displayValue = PowerUnits.convertPower(valueKW, unit);
    return { value: displayValue.toFixed(2), unit: unit };
}

function formatPowerValueWithUnit(valueKW) {
    const formatted = formatPowerValue(valueKW);
    return `${formatted.value} ${formatted.unit}`;
}

/**
 * Update all power unit labels in the UI
 */
function updatePowerUnitLabels() {
    const unit = PowerUnits.getPowerUnit();
    $('#power-unit-label, #power-unit-label-1, #power-unit-label-2').text(unit);
    $('#max-power-unit-label, #max-power-unit-label-1, #max-power-unit-label-2').text(unit);
}

// ========================================
// CHART INITIALIZATION
// ========================================

/**
 * Initialize ApexChart with default configuration
 */
function initChart() {
    var apexOptions = {
        chart: {
            type: 'line',
            height: getChartHeight(),
            toolbar: { show: true },
            animations: { enabled: false }
        },
        series: [],
        stroke: {
            curve: 'straight',
            width: 1
        },
        markers: {
            size: 0
        },
        tooltip: {
            enabled: true,
            intersect: false,
            shared: true,
            x: {
                formatter: function (val, { seriesIndex, dataPointIndex, w }) {
                    if (isComparisonMode && w.globals.initialConfig.xaxis.type === 'numeric') {
                        return `RPM: ${val.toFixed(0)}`;
                    }
                    const totalMs = Math.round(val * 1000);
                    const minutes = Math.floor(totalMs / 60000);
                    const seconds = Math.floor((totalMs % 60000) / 1000);
                    const milliseconds = totalMs % 1000;
                    return `Time: ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(milliseconds).padStart(3, '0')}`;
                }
            }
        },
        xaxis: {
            type: "numeric",
            tickAmount: 5,
            labels: {
                rotate: 0,
                formatter: val => {
                    if (isComparisonMode && apexChart?.opts?.xaxis?.title?.text?.includes('RPM')) {
                        return val.toFixed(0);
                    }
                    const minutes = Math.floor(val / 60);
                    const seconds = Math.floor(val % 60);
                    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
                }
            },
            title: { text: "Time (MM:SS)" }
        },
        yaxis: [],
        colors: LOG_COLORS[0],
        legend: {
            show: true,
            position: 'top'
        }
    };

    apexChart = new ApexCharts(document.querySelector("#chart"), apexOptions);
    apexChart.render();

    window.addEventListener('resize', function () {
        if (apexChart) {
            apexChart.updateOptions({
                chart: { height: getChartHeight() }
            });
        }
    });
}

/**
 * Calculate chart height based on mode
 * Comparison mode uses more vertical space
 */
function getChartHeight() {
    if (isComparisonMode) {
        // In comparison mode, occupy most of the container height (minus header/margins)
        // Container is approx 100vh - 80px. Legend is small.
        return window.innerHeight - 130;
    }
    // In single mode, leave space for cards
    return window.innerHeight * 0.74;
}

// ========================================
// SINGLE LOG CHART DISPLAY
// ========================================

/**
 * Update chart with single log data
 * Handles both dynamic mode (Power vs Speed) and time-based modes
 */
function updateChartFromJSON(data) {
    if (!apexChart) return;

    isComparisonMode = false;
    currentLogData1 = data;
    currentLogData2 = null;

    // Hide empty state and show content
    $("#emptyState").css('display', 'none');
    $("#contentContainer").css('display', 'flex');

    updateUIForSingleLog();

    const isDynamicMode = data.run_mode === "dynamic";

    const startTimestamp = data.data[0]?.timestamp || 0;
    const powerSeries = data.data.map(entry => [(entry.timestamp - startTimestamp) / 1000, PowerUnits.convertPower(entry.power)]);
    const torqueSeries = data.data.map(entry => [(entry.timestamp - startTimestamp) / 1000, entry.torque]);
    const rpmSeries = data.data.map(entry => [(entry.timestamp - startTimestamp) / 1000, entry.rpm]);

    const rpmValues = data.data.map(entry => entry.rpm);
    const powerValuesKW = data.data.map(entry => entry.power);
    const torqueValues = data.data.map(entry => entry.torque);

    const maxTorque = Math.max(...torqueValues);
    const maxPowerKW = Math.max(...powerValuesKW);
    const maxSpeed = Math.max(...rpmValues);
    // Use saved time_elapsed if available, otherwise calculate from timestamps
    const timeElapsed = data.time_elapsed || (data.data[data.data.length - 1].timestamp - startTimestamp) / 1000;
    const rpmAtMaxTorque = rpmValues[torqueValues.indexOf(maxTorque)];
    const rpmAtMaxPower = rpmValues[powerValuesKW.indexOf(maxPowerKW)];

    // Update single display
    $("#logPower").text("-");
    $("#logTorque").text("-");
    $("#logMotorSpeed").text("-");
    const formattedMaxPower = formatPowerValue(maxPowerKW);
    $("#logMaxPower").text(formattedMaxPower.value);
    $("#logMaxTorque").text(maxTorque.toFixed(2));
    $("#logMaxSpeed").text(maxSpeed);
    $("#logTimeElapsed").text(timeElapsed.toFixed(2));
    $("#logMaxPowerRpm").html(`<span id="max-power-unit-label">${formattedMaxPower.unit}</span> @ ${rpmAtMaxPower} rpm`);
    $("#logMaxTorqueRpm").text(`Nm @ ${rpmAtMaxTorque} rpm`);

    const currentUnitPower = PowerUnits.getPowerUnit();
    const convertedMaxPower = PowerUnits.convertPower(maxPowerKW, currentUnitPower);
    updatePowerUnitLabels();

    if (isDynamicMode) {
        // Sort by RPM so the line traces a clean curve. Saved data is in
        // collection (time) order and RPM jitter would otherwise produce Z-draws.
        const sortedData = [...data.data].sort((a, b) => a.rpm - b.rpm);
        const dynamicPowerSeries = sortedData.map(entry => [entry.rpm, PowerUnits.convertPower(entry.power)]);
        const dynamicTorqueSeries = sortedData.map(entry => [entry.rpm, entry.torque]);

        apexChart.updateOptions({
            chart: {
                height: getChartHeight(),
                type: 'line',
                events: {
                    mouseMove: function (event, chartContext, opts) {
                        if (opts.dataPointIndex !== undefined) {
                            const i = opts.dataPointIndex;
                            if (sortedData[i] !== undefined) {
                                const formattedPower = formatPowerValue(sortedData[i].power);
                                $("#logPower").text(formattedPower.value);
                                $("#logTorque").text(sortedData[i].torque.toFixed(2));
                                $("#logMotorSpeed").text(sortedData[i].rpm);
                            }
                        }
                    }
                }
            },
            stroke: {
                curve: 'straight',
                width: 1
            },
            xaxis: {
                type: "numeric",
                title: { text: "Motor Speed (RPM)" },
                tickAmount: 10,
                labels: { formatter: val => val.toFixed(0) }
            },
            yaxis: [
                {
                    title: { text: `Power (${getPowerUnitLabel()})` },
                    labels: { formatter: val => val.toFixed(1) },
                    opposite: false,
                    logarithmic: false,
                    forceNiceScale: false
                },
                {
                    title: { text: "Torque (Nm)" },
                    labels: { formatter: val => val.toFixed(1) },
                    opposite: true,
                    logarithmic: false,
                    forceNiceScale: false
                }
            ],
            tooltip: {
                enabled: true,
                shared: true,
                intersect: false,
                custom: undefined,
                x: { formatter: val => `RPM: ${val.toFixed(0)}` }
            },
            markers: {
                size: 0,
                hover: { size: 5 }
            },
            colors: LOG_COLORS[0],
            annotations: {
                yaxis: [
                    {
                        y: convertedMaxPower,
                        yAxisIndex: 0,
                        borderColor: '#FF0000',
                        borderWidth: 1,
                        strokeDashArray: 5,
                        label: {
                            borderColor: '#FF0000',
                            style: {
                                color: '#fff',
                                background: '#FF0000'
                            },
                            text: `Max Power: ${formatPowerValueWithUnit(maxPowerKW)}`,
                            position: 'left',
                            offsetX: 130
                        }
                    },
                    {
                        y: maxTorque,
                        yAxisIndex: 1,
                        borderColor: '#FF0000',
                        borderWidth: 1,
                        strokeDashArray: 5,
                        label: {
                            borderColor: '#FF0000',
                            style: {
                                color: '#fff',
                                background: '#FF0000'
                            },
                            text: `Max Torque: ${maxTorque.toFixed(2)} Nm`,
                            position: 'right',
                            offsetX: 0
                        }
                    }
                ]
            },
            series: [
                { name: `Power (${getPowerUnitLabel()})`, data: dynamicPowerSeries },
                { name: 'Torque (Nm)', data: dynamicTorqueSeries }
            ]
        });
    } else {
        const yaxisConfig = [
            {
                title: { text: `Power (${getPowerUnitLabel()})` },
                labels: { formatter: val => val.toFixed(1) },
                opposite: false,
                logarithmic: false,
                forceNiceScale: false
            },
            {
                title: { text: "Torque (Nm)" },
                labels: { formatter: val => val.toFixed(1) },
                opposite: true,
                logarithmic: false,
                forceNiceScale: false
            }
        ];

        const seriesData = [
            { name: `Power (${getPowerUnitLabel()})`, data: powerSeries },
            { name: 'Torque (Nm)', data: torqueSeries }
        ];

        if (data.run_mode !== "torque" && data.run_mode !== "speed") {
            yaxisConfig.push({
                title: { text: "Speed (RPM)" },
                labels: { formatter: val => val.toFixed(0) },
                opposite: false,
                show: true,
                logarithmic: false,
                forceNiceScale: false
            });
            seriesData.push({ name: 'Speed (RPM)', data: rpmSeries });
        }

        apexChart.updateOptions({
            chart: {
                height: getChartHeight(),
                type: 'line',
                events: {
                    mouseMove: function (event, chartContext, opts) {
                        if (opts.dataPointIndex !== undefined) {
                            const i = opts.dataPointIndex;
                            if (rpmValues[i] !== undefined) {
                                const formattedPower = formatPowerValue(powerValuesKW[i]);
                                $("#logPower").text(formattedPower.value);
                                $("#logTorque").text(torqueValues[i].toFixed(2));
                                $("#logMotorSpeed").text(rpmValues[i]);
                            }
                        }
                    }
                }
            },
            stroke: {
                curve: 'straight',
                width: 1
            },
            xaxis: {
                type: "numeric",
                tickAmount: 5,
                labels: {
                    rotate: 0,
                    formatter: val => {
                        const minutes = Math.floor(val / 60);
                        const seconds = Math.floor(val % 60);
                        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
                    }
                },
                title: { text: "Time (MM:SS)" }
            },
            yaxis: yaxisConfig,
            colors: LOG_COLORS[0],
            annotations: {
                yaxis: data.run_mode === "speed" ? [
                    // Speed mode: show max torque
                    {
                        y: maxTorque,
                        yAxisIndex: 1,
                        borderColor: '#FF0000',
                        borderWidth: 1,
                        strokeDashArray: 5,
                        label: {
                            borderColor: '#FF0000',
                            style: { color: '#fff', background: '#FF0000' },
                            text: `Max Torque: ${maxTorque.toFixed(2)} Nm`
                        }
                    }
                ] : data.run_mode === "torque" ? [
                    // Torque mode: show max speed
                    {
                        y: maxSpeed,
                        yAxisIndex: 2,
                        borderColor: '#FF0000',
                        borderWidth: 1,
                        strokeDashArray: 5,
                        label: {
                            borderColor: '#FF0000',
                            style: { color: '#fff', background: '#FF0000' },
                            text: `Max Speed: ${maxSpeed} RPM`
                        }
                    }
                ] : [
                    // Other modes: show max power and max torque
                    {
                        y: convertedMaxPower,
                        yAxisIndex: 0,
                        borderColor: '#FF0000',
                        borderWidth: 1,
                        strokeDashArray: 5,
                        label: {
                            borderColor: '#FF0000',
                            style: { color: '#fff', background: '#FF0000' },
                            text: `Max Power: ${formatPowerValueWithUnit(maxPowerKW)}`,
                            position: 'left',
                            offsetX: 130
                        }
                    },
                    {
                        y: maxTorque,
                        yAxisIndex: 1,
                        borderColor: '#FF0000',
                        borderWidth: 1,
                        strokeDashArray: 5,
                        label: {
                            borderColor: '#FF0000',
                            style: { color: '#fff', background: '#FF0000' },
                            text: `Max Torque: ${maxTorque.toFixed(2)} Nm`,
                            position: 'right',
                            offsetX: 0
                        }
                    }
                ]
            },
            tooltip: {
                enabled: true,
                shared: true,
                intersect: false,
                custom: undefined
            },
            markers: {
                size: 0,
                hover: { size: 5 }
            },
            series: seriesData
        });
    }
}

// ========================================
// COMPARISON MODE
// ========================================

/**
 * Update chart for comparison mode (two logs side-by-side)
 * Validates that both logs have the same run mode
 */
function updateComparisonChart(log1, log2) {
    if (!apexChart) return;

    if (log1.run_mode !== log2.run_mode) {
        alert("Cannot compare logs with different run modes!");
        return;
    }

    isComparisonMode = true;
    currentLogData1 = log1;
    currentLogData2 = log2;

    // Hide empty state and show content
    $("#emptyState").css('display', 'none');
    $("#contentContainer").css('display', 'flex');

    updateUIForComparison(log1, log2);

    const isDynamicMode = log1.run_mode === "dynamic";

    if (isDynamicMode) {
        updateDynamicComparisonChart(log1, log2);
    } else {
        updateTimeBasedComparisonChart(log1, log2);
    }
}

/**
 * Update comparison chart for dynamic mode (Power vs Speed)
 * Shows two logs with interpolated tooltip values at any RPM
 */
function updateDynamicComparisonChart(log1, log2) {
    const log1Name = DynoUtils.escapeHtml(log1.name);
    const log2Name = DynoUtils.escapeHtml(log2.name);

    // Sort by RPM so each curve traces left-to-right without Z-draws.
    const sorted1 = [...log1.data].sort((a, b) => a.rpm - b.rpm);
    const sorted2 = [...log2.data].sort((a, b) => a.rpm - b.rpm);

    // Use original data points for each log - NO interpolation to common points!
    const power1 = sorted1.map(d => [d.rpm, PowerUnits.convertPower(d.power)]);
    const torque1 = sorted1.map(d => [d.rpm, d.torque]);
    const power2 = sorted2.map(d => [d.rpm, PowerUnits.convertPower(d.power)]);
    const torque2 = sorted2.map(d => [d.rpm, d.torque]);

    // Get min/max for each metric to set proper y-axis scales
    const power1Values = power1.map(p => p[1]);
    const torque1Values = torque1.map(t => t[1]);
    const power2Values = power2.map(p => p[1]);
    const torque2Values = torque2.map(t => t[1]);
    const rpm1Values = sorted1.map(d => d.rpm);
    const rpm2Values = sorted2.map(d => d.rpm);

    const minPower = Math.min(Math.min(...power1Values), Math.min(...power2Values));
    const maxPower = Math.max(Math.max(...power1Values), Math.max(...power2Values));
    const minTorque = Math.min(Math.min(...torque1Values), Math.min(...torque2Values));
    const maxTorque = Math.max(Math.max(...torque1Values), Math.max(...torque2Values));
    const minRpm = Math.min(Math.min(...rpm1Values), Math.min(...rpm2Values));
    const maxRpm = Math.max(Math.max(...rpm1Values), Math.max(...rpm2Values));

    // Add some padding to the axes
    const powerPadding = (maxPower - minPower) * 0.1;
    const torquePadding = (maxTorque - minTorque) * 0.1;

    apexChart.updateOptions({
        chart: {
            height: getChartHeight(),
            type: 'line',
            events: {
                mouseMove: function (event, chartContext, opts) {
                    if (opts.dataPointIndex !== undefined && opts.seriesIndex !== undefined) {
                        const seriesIndex = opts.seriesIndex;
                        const dataPointIndex = opts.dataPointIndex;

                        // Determine which log and series we're hovering over.
                        // Index into the sorted arrays so the cursor's point matches the rendered line.
                        let hoveredLog, hoveredData;
                        if (seriesIndex === 0 || seriesIndex === 1) {
                            // Log 1
                            hoveredLog = log1;
                            hoveredData = sorted1[dataPointIndex];
                        } else {
                            // Log 2
                            hoveredLog = log2;
                            hoveredData = sorted2[dataPointIndex];
                        }

                        if (hoveredData) {
                            const rpm = hoveredData.rpm;

                            // Interpolate values for both logs at this RPM for comparison
                            const power1KW = interpolateValue(log1.data, rpm, 'power');
                            const torque1 = interpolateValue(log1.data, rpm, 'torque');
                            const power2KW = interpolateValue(log2.data, rpm, 'power');
                            const torque2 = interpolateValue(log2.data, rpm, 'torque');

                            // Set "-" for cursor data in comparison mode
                            $("#logPower").text("-");
                            $("#logTorque").text("-");
                            $("#logMotorSpeed").text("-");

                            // But update the comparison displays
                            const power1Converted = PowerUnits.convertPower(power1KW);
                            const power2Converted = PowerUnits.convertPower(power2KW);
                            $("#logPower1").text(power1Converted.toFixed(2));
                            $("#logTorque1").text(torque1.toFixed(2));
                            $("#logMotorSpeed1").text(Math.round(rpm));
                            $("#logPower2").text(power2Converted.toFixed(2));
                            $("#logTorque2").text(torque2.toFixed(2));
                            $("#logMotorSpeed2").text(Math.round(rpm));
                        }
                    }
                }
            }
        },
        stroke: {
            curve: 'straight',
            width: 1
        },
        annotations: { yaxis: [] },
        xaxis: {
            type: "numeric",
            title: { text: "Motor Speed (RPM)" },
            tickAmount: 10,
            labels: { formatter: val => val.toFixed(0) },
            min: Math.floor(minRpm * 0.95),
            max: Math.ceil(maxRpm * 1.05)
        },
        yaxis: [
            {
            title: { text: `${log1Name} Power (${getPowerUnitLabel()})` },
            labels: { formatter: val => val.toFixed(1) },
            opposite: false,
            min: Math.floor((minPower - powerPadding) * 10) / 10,
            max: Math.ceil((maxPower + powerPadding) * 10) / 10,
            tickAmount: 5,
            logarithmic: false,
            forceNiceScale: false
        },
        {
            title: { text: `${log1Name} Torque (Nm)` },
            labels: { formatter: val => val.toFixed(1) },
            opposite: true,
            min: Math.floor((minTorque - torquePadding) * 10) / 10,
            max: Math.ceil((maxTorque + torquePadding) * 10) / 10,
            tickAmount: 5,
            logarithmic: false,
            forceNiceScale: false
        },
        {
            title: { text: `${log2Name} Power (${getPowerUnitLabel()})` },
            labels: { formatter: val => val.toFixed(1) },
            opposite: false,
            show: false,
            min: Math.floor((minPower - powerPadding) * 10) / 10,
            max: Math.ceil((maxPower + powerPadding) * 10) / 10,
            logarithmic: false,
            forceNiceScale: false
        },
        {
            title: { text: `${log2Name} Torque (Nm)` },
                labels: { formatter: val => val.toFixed(1) },
                opposite: true,
                show: false,
                min: Math.floor((minTorque - torquePadding) * 10) / 10,
                max: Math.ceil((maxTorque + torquePadding) * 10) / 10,
                logarithmic: false,
                forceNiceScale: false
            }
        ],
        tooltip: {
            shared: false,
            intersect: false,
            custom: function ({ series, seriesIndex, dataPointIndex, w }) {
                // Get the RPM value from the hovered point
                const hoveredSeries = w.globals.initialSeries[seriesIndex];
                const hoveredPoint = hoveredSeries.data[dataPointIndex];
                if (!hoveredPoint) return '';
                const rpm = hoveredPoint[0];

                // Interpolate values for all series at this RPM
                const power1Val = interpolateFromSeries(power1, rpm);
                const torque1Val = interpolateFromSeries(torque1, rpm);
                const power2Val = interpolateFromSeries(power2, rpm);
                const torque2Val = interpolateFromSeries(torque2, rpm);

                // Calculate absolute differences
                const torqueDiff = Math.abs(torque1Val - torque2Val);
                const powerDiff = Math.abs(power1Val - power2Val);

                const log1Name = DynoUtils.escapeHtml(log1.name);
                const log2Name = DynoUtils.escapeHtml(log2.name);

                return `<div class="apexcharts-tooltip-custom" style="padding: 8px; background: rgba(0,0,0,0.85); color: #fff; border-radius: 4px;">
                    <div style="font-weight: bold; margin-bottom: 6px;">RPM: ${rpm.toFixed(0)}</div>
                    <div style="display: flex; align-items: center; margin-bottom: 4px; border-bottom: 1px solid #444; padding-bottom: 4px;">
                        <div style="flex: 1;">
                            <div style="font-weight: bold; margin-bottom: 2px; color: #aaa;">Torque</div>
                            <span style="color: ${LOG_COLORS[0][1]};">●</span> ${log1Name}: ${torque1Val.toFixed(2)} Nm<br>
                            <span style="color: ${LOG_COLORS[1][1]};">●</span> ${log2Name}: ${torque2Val.toFixed(2)} Nm
                        </div>
                        <div style="margin-left: 12px; padding: 4px 8px; background: rgba(255,255,255,0.1); border-radius: 4px; text-align: center;">
                            <div style="font-size: 10px; color: #aaa;">Δ</div>
                            <div style="font-weight: bold;">${torqueDiff.toFixed(2)} Nm</div>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center;">
                        <div style="flex: 1;">
                            <div style="font-weight: bold; margin-bottom: 2px; color: #aaa;">Power</div>
                            <span style="color: ${LOG_COLORS[0][0]};">●</span> ${log1Name}: ${power1Val.toFixed(2)} ${getPowerUnitLabel()}<br>
                            <span style="color: ${LOG_COLORS[1][0]};">●</span> ${log2Name}: ${power2Val.toFixed(2)} ${getPowerUnitLabel()}
                        </div>
                        <div style="margin-left: 12px; padding: 4px 8px; background: rgba(255,255,255,0.1); border-radius: 4px; text-align: center;">
                            <div style="font-size: 10px; color: #aaa;">Δ</div>
                            <div style="font-weight: bold;">${powerDiff.toFixed(2)} ${getPowerUnitLabel()}</div>
                        </div>
                    </div>
                </div>`;
            }
        },
        colors: [
            LOG_COLORS[0][0], // Log1 Power
            LOG_COLORS[0][1], // Log1 Torque
            LOG_COLORS[1][0], // Log2 Power
            LOG_COLORS[1][1], // Log2 Torque
            LOG_COLORS[0][2], // Log1 RPM
            LOG_COLORS[1][2]  // Log2 RPM
        ],
        markers: {
            size: 0,
            hover: { size: 0 }
        },
        series: [
            { name: `${log1Name} - Power (${getPowerUnitLabel()})`, data: power1 },
            { name: `${log1Name} - Torque (Nm)`, data: torque1 },
            { name: `${log2Name} - Power (${getPowerUnitLabel()})`, data: power2 },
            { name: `${log2Name} - Torque (Nm)`, data: torque2 }
        ]
    });
}

/**
 * Update comparison chart for time-based modes
 * Shows two logs with interpolated tooltip values at any time
 */
function updateTimeBasedComparisonChart(log1, log2) {
    const log1Name = DynoUtils.escapeHtml(log1.name);
    const log2Name = DynoUtils.escapeHtml(log2.name);

    const startTimestamp1 = log1.data[0]?.timestamp || 0;
    const startTimestamp2 = log2.data[0]?.timestamp || 0;

    const powerSeries1 = log1.data.map(entry => [(entry.timestamp - startTimestamp1) / 1000, PowerUnits.convertPower(entry.power)]);
    const torqueSeries1 = log1.data.map(entry => [(entry.timestamp - startTimestamp1) / 1000, entry.torque]);
    const powerSeries2 = log2.data.map(entry => [(entry.timestamp - startTimestamp2) / 1000, PowerUnits.convertPower(entry.power)]);
    const torqueSeries2 = log2.data.map(entry => [(entry.timestamp - startTimestamp2) / 1000, entry.torque]);

    const power1Values = powerSeries1.map(p => p[1]);
    const torque1Values = torqueSeries1.map(t => t[1]);
    const power2Values = powerSeries2.map(p => p[1]);
    const torque2Values = torqueSeries2.map(t => t[1]);

    const minPower = Math.min(Math.min(...power1Values), Math.min(...power2Values));
    const maxPower = Math.max(Math.max(...power1Values), Math.max(...power2Values));
    const minTorque = Math.min(Math.min(...torque1Values), Math.min(...torque2Values));
    const maxTorque = Math.max(Math.max(...torque1Values), Math.max(...torque2Values));

    const powerPadding = (maxPower - minPower) * 0.1;
    const torquePadding = (maxTorque - minTorque) * 0.1;

    // ApexCharts requires one yaxis entry per series.
    // Series order: Log1 Power, Log1 Torque, Log2 Power, Log2 Torque [, Log1 RPM, Log2 RPM]
    const yaxisConfig = [
        {
            title: { text: `Power (${getPowerUnitLabel()})` },
            labels: { formatter: val => val.toFixed(1) },
            opposite: false,
            min: Math.floor((minPower - powerPadding) * 10) / 10,
            max: Math.ceil((maxPower + powerPadding) * 10) / 10,
            logarithmic: false,
            forceNiceScale: false
        },
        {
            title: { text: "Torque (Nm)" },
            labels: { formatter: val => val.toFixed(1) },
            opposite: true,
            min: Math.floor((minTorque - torquePadding) * 10) / 10,
            max: Math.ceil((maxTorque + torquePadding) * 10) / 10,
            logarithmic: false,
            forceNiceScale: false
        },
        {
            title: { text: `Power (${getPowerUnitLabel()})` },
            labels: { formatter: val => val.toFixed(1) },
            opposite: false,
            show: false,
            min: Math.floor((minPower - powerPadding) * 10) / 10,
            max: Math.ceil((maxPower + powerPadding) * 10) / 10,
            logarithmic: false,
            forceNiceScale: false
        },
        {
            title: { text: "Torque (Nm)" },
            labels: { formatter: val => val.toFixed(1) },
            opposite: true,
            show: false,
            min: Math.floor((minTorque - torquePadding) * 10) / 10,
            max: Math.ceil((maxTorque + torquePadding) * 10) / 10,
            logarithmic: false,
            forceNiceScale: false
        }
    ];

    if (log1.run_mode !== "torque" && log1.run_mode !== "speed") {
        const rpmSeries1 = log1.data.map(entry => [(entry.timestamp - startTimestamp1) / 1000, entry.rpm]);
        const rpmSeries2 = log2.data.map(entry => [(entry.timestamp - startTimestamp2) / 1000, entry.rpm]);
        const rpm1Values = rpmSeries1.map(r => r[1]);
        const rpm2Values = rpmSeries2.map(r => r[1]);
        const minRpm = Math.min(Math.min(...rpm1Values), Math.min(...rpm2Values));
        const maxRpm = Math.max(Math.max(...rpm1Values), Math.max(...rpm2Values));
        const rpmPadding = (maxRpm - minRpm) * 0.1;

        yaxisConfig.push(
            {
                title: { text: "Speed (RPM)" },
                labels: { formatter: val => val.toFixed(0) },
                opposite: false,
                min: Math.floor((minRpm - rpmPadding) * 10) / 10,
                max: Math.ceil((maxRpm + rpmPadding) * 10) / 10,
                show: true,
                logarithmic: false,
                forceNiceScale: false
            },
            {
                title: { text: "Speed (RPM)" },
                labels: { formatter: val => val.toFixed(0) },
                opposite: false,
                show: false,
                min: Math.floor((minRpm - rpmPadding) * 10) / 10,
                max: Math.ceil((maxRpm + rpmPadding) * 10) / 10,
                logarithmic: false,
                forceNiceScale: false
            }
        );
    }

    const seriesData = [
        { name: `${log1Name} - Power (${getPowerUnitLabel()})`, data: powerSeries1 },
        { name: `${log1Name} - Torque (Nm)`, data: torqueSeries1 },
        { name: `${log2Name} - Power (${getPowerUnitLabel()})`, data: powerSeries2 },
        { name: `${log2Name} - Torque (Nm)`, data: torqueSeries2 }
    ];

    if (log1.run_mode !== "torque" && log1.run_mode !== "speed") {
        const rpmSeries1 = log1.data.map(entry => [(entry.timestamp - startTimestamp1) / 1000, entry.rpm]);
        const rpmSeries2 = log2.data.map(entry => [(entry.timestamp - startTimestamp2) / 1000, entry.rpm]);
        seriesData.push(
            { name: `${log1Name} - Speed (RPM)`, data: rpmSeries1 },
            { name: `${log2Name} - Speed (RPM)`, data: rpmSeries2 }
        );
    }

    apexChart.updateOptions({
        chart: {
            height: getChartHeight(),
            type: 'line',
            events: {
                mouseMove: function (event, chartContext, opts) {
                    // In comparison mode, set "-" for cursor data
                    $("#logPower, #logTorque, #logMotorSpeed").text("-");
                }
            }
        },
        stroke: {
            curve: 'straight',
            width: 1
        },
        annotations: { yaxis: [] },
        xaxis: {
            type: "numeric",
            tickAmount: 5,
            labels: {
                rotate: 0,
                formatter: val => {
                    const minutes = Math.floor(val / 60);
                    const seconds = Math.floor(val % 60);
                    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
                }
            },
            title: { text: "Time (MM:SS)" }
        },
        yaxis: yaxisConfig,
        colors: [
            LOG_COLORS[0][0], // Log1 Power
            LOG_COLORS[0][1], // Log1 Torque
            LOG_COLORS[1][0], // Log2 Power
            LOG_COLORS[1][1], // Log2 Torque
            LOG_COLORS[0][2], // Log1 Speed
            LOG_COLORS[1][2]  // Log2 Speed
        ],
        markers: {
            size: 0,
            hover: { size: 0 }
        },
        tooltip: {
            shared: false,
            intersect: false,
            custom: function ({ series, seriesIndex, dataPointIndex, w }) {
                // Get the time value from the hovered point
                const hoveredSeries = w.globals.initialSeries[seriesIndex];
                const hoveredPoint = hoveredSeries.data[dataPointIndex];
                if (!hoveredPoint) return '';
                const time = hoveredPoint[0];

                // Format time as MM:SS:mmm
                const totalMs = Math.round(time * 1000);
                const minutes = Math.floor(totalMs / 60000);
                const seconds = Math.floor((totalMs % 60000) / 1000);
                const milliseconds = totalMs % 1000;
                const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(milliseconds).padStart(3, '0')}`;

                // Interpolate values for all series at this time
                const power1Val = interpolateFromSeries(powerSeries1, time);
                const torque1Val = interpolateFromSeries(torqueSeries1, time);
                const power2Val = interpolateFromSeries(powerSeries2, time);
                const torque2Val = interpolateFromSeries(torqueSeries2, time);

                // Calculate absolute differences
                const torqueDiff = Math.abs(torque1Val - torque2Val);
                const powerDiff = Math.abs(power1Val - power2Val);

                const log1Name = DynoUtils.escapeHtml(log1.name);
                const log2Name = DynoUtils.escapeHtml(log2.name);

                let html = `<div class="apexcharts-tooltip-custom" style="padding: 8px; background: rgba(0,0,0,0.85); color: #fff; border-radius: 4px;">
                    <div style="font-weight: bold; margin-bottom: 6px;">Time: ${timeStr}</div>
                    <div style="display: flex; align-items: center; margin-bottom: 4px; border-bottom: 1px solid #444; padding-bottom: 4px;">
                        <div style="flex: 1;">
                            <div style="font-weight: bold; margin-bottom: 2px; color: #aaa;">Torque</div>
                            <span style="color: ${LOG_COLORS[0][1]};">●</span> ${log1Name}: ${torque1Val.toFixed(2)} Nm<br>
                            <span style="color: ${LOG_COLORS[1][1]};">●</span> ${log2Name}: ${torque2Val.toFixed(2)} Nm
                        </div>
                        <div style="margin-left: 12px; padding: 4px 8px; background: rgba(255,255,255,0.1); border-radius: 4px; text-align: center;">
                            <div style="font-size: 10px; color: #aaa;">Δ</div>
                            <div style="font-weight: bold;">${torqueDiff.toFixed(2)} Nm</div>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center;">
                        <div style="flex: 1;">
                            <div style="font-weight: bold; margin-bottom: 2px; color: #aaa;">Power</div>
                            <span style="color: ${LOG_COLORS[0][0]};">●</span> ${log1Name}: ${power1Val.toFixed(2)} ${getPowerUnitLabel()}<br>
                            <span style="color: ${LOG_COLORS[1][0]};">●</span> ${log2Name}: ${power2Val.toFixed(2)} ${getPowerUnitLabel()}
                        </div>
                        <div style="margin-left: 12px; padding: 4px 8px; background: rgba(255,255,255,0.1); border-radius: 4px; text-align: center;">
                            <div style="font-size: 10px; color: #aaa;">Δ</div>
                            <div style="font-weight: bold;">${powerDiff.toFixed(2)} ${getPowerUnitLabel()}</div>
                        </div>
                    </div>
                </div>`;
                return html;
            }
        },
        series: seriesData
    });
}

// ========================================
// INTERPOLATION FUNCTIONS
// ========================================

/**
 * Interpolate value for a target RPM from log data
 * Used for comparison tooltips when data points don't align exactly
 */
function interpolateValue(data, targetRpm, field) {
    const sortedData = [...data].sort((a, b) => a.rpm - b.rpm);

    if (sortedData.length === 0) return 0;
    if (targetRpm <= sortedData[0].rpm) return sortedData[0][field];
    if (targetRpm >= sortedData[sortedData.length - 1].rpm) return sortedData[sortedData.length - 1][field];

    for (let i = 0; i < sortedData.length - 1; i++) {
        if (sortedData[i].rpm <= targetRpm && sortedData[i + 1].rpm >= targetRpm) {
            const ratio = (targetRpm - sortedData[i].rpm) / (sortedData[i + 1].rpm - sortedData[i].rpm);
            return sortedData[i][field] + ratio * (sortedData[i + 1][field] - sortedData[i][field]);
        }
    }

    return sortedData[0][field];
}

/**
 * Interpolate from series data format [[x, y], [x, y], ...]
 * Used for comparison tooltips with time-based data
 */
function interpolateFromSeries(seriesData, targetX) {
    if (!seriesData || seriesData.length === 0) return 0;

    // Sort by X value
    const sorted = [...seriesData].sort((a, b) => a[0] - b[0]);

    if (targetX <= sorted[0][0]) return sorted[0][1];
    if (targetX >= sorted[sorted.length - 1][0]) return sorted[sorted.length - 1][1];

    for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i][0] <= targetX && sorted[i + 1][0] >= targetX) {
            const ratio = (targetX - sorted[i][0]) / (sorted[i + 1][0] - sorted[i][0]);
            return sorted[i][1] + ratio * (sorted[i + 1][1] - sorted[i][1]);
        }
    }

    return sorted[0][1];
}

// ========================================
// UI UPDATE FUNCTIONS
// ========================================

/**
 * Update UI for single log display mode
 * Shows single display cards, hides comparison displays
 */
function updateUIForSingleLog() {
    $("#comparisonLegend").hide();

    // Show single displays, hide comparison displays
    $("[id$='SingleDisplay']").show();
    $("[id$='ComparisonDisplay']").hide();

    // Show the bottom stats cards for single log view
    // Adjust this selector to match your HTML structure (e.g., '.stats-cards', '#bottomCards', '.card-container')
    $(".card").show();

    // Reset all values to "-"
    $("#logPower, #logTorque, #logMotorSpeed, #logMaxPower, #logMaxTorque, #logMaxSpeed, #logTimeElapsed").text("-");
    $("#logMaxPowerRpm, #logMaxTorqueRpm").text("");

    // Also reset comparison displays
    $("#logPower1, #logTorque1, #logMotorSpeed1, #logMaxPower1, #logMaxTorque1, #logMaxSpeed1, #logTimeElapsed1").text("-");
    $("#logMaxPowerRpm1, #logMaxTorqueRpm1").text("");
    $("#logPower2, #logTorque2, #logMotorSpeed2, #logMaxPower2, #logMaxTorque2, #logMaxSpeed2, #logTimeElapsed2").text("-");
    $("#logMaxPowerRpm2, #logMaxTorqueRpm2").text("");

    // Update chart height for single mode
    if (apexChart) {
        apexChart.updateOptions({
            chart: { height: getChartHeight() }
        });
    }
}

/**
 * Update UI for comparison mode
 * Shows comparison displays, updates legend with log names
 */
function updateUIForComparison(log1, log2) {
    $("#comparisonLegend").show();
    $("#legendLog1").text(log1.name);
    $("#legendLog2").text(log2.name);

    // Hide single displays, show comparison displays
    $("[id$='SingleDisplay']").hide();
    $("[id$='ComparisonDisplay']").show();

    // Hide the bottom stats cards in comparison mode
    // Adjust this selector to match your HTML structure (e.g., '.stats-cards', '#bottomCards', '.card-container')
    $(".card").hide();

    // Set cursor data to "-" in single display
    $("#logPower, #logTorque, #logMotorSpeed").text("-");

    // Calculate max values for both logs
    const maxTorque1 = Math.max(...log1.data.map(d => d.torque));
    const maxPower1 = Math.max(...log1.data.map(d => d.power));
    const maxSpeed1 = Math.max(...log1.data.map(d => d.rpm));
    // Use saved time_elapsed if available, otherwise calculate from timestamps
    const timeElapsed1 = log1.time_elapsed || (log1.data[log1.data.length - 1].timestamp - log1.data[0].timestamp) / 1000;
    const rpmAtMaxTorque1 = log1.data[log1.data.map(d => d.torque).indexOf(maxTorque1)].rpm;
    const rpmAtMaxPower1 = log1.data[log1.data.map(d => d.power).indexOf(maxPower1)].rpm;

    const maxTorque2 = Math.max(...log2.data.map(d => d.torque));
    const maxPower2 = Math.max(...log2.data.map(d => d.power));
    const maxSpeed2 = Math.max(...log2.data.map(d => d.rpm));
    // Use saved time_elapsed if available, otherwise calculate from timestamps
    const timeElapsed2 = log2.time_elapsed || (log2.data[log2.data.length - 1].timestamp - log2.data[0].timestamp) / 1000;
    const rpmAtMaxTorque2 = log2.data[log2.data.map(d => d.torque).indexOf(maxTorque2)].rpm;
    const rpmAtMaxPower2 = log2.data[log2.data.map(d => d.power).indexOf(maxPower2)].rpm;

    // Update comparison displays
    const formattedMaxPower1 = formatPowerValue(maxPower1);
    const formattedMaxPower2 = formatPowerValue(maxPower2);
    $("#logMaxPower1").text(formattedMaxPower1.value);
    $("#logMaxTorque1").text(maxTorque1.toFixed(2));
    $("#logMaxSpeed1").text(maxSpeed1);
    $("#logTimeElapsed1").text(timeElapsed1.toFixed(2));
    $("#logMaxPowerRpm1").html(`<span id="max-power-unit-label-1">${formattedMaxPower1.unit}</span> @ ${rpmAtMaxPower1} rpm`);
    $("#logMaxTorqueRpm1").text(`Nm @ ${rpmAtMaxTorque1} rpm`);

    $("#logMaxPower2").text(formattedMaxPower2.value);
    $("#logMaxTorque2").text(maxTorque2.toFixed(2));
    $("#logMaxSpeed2").text(maxSpeed2);
    $("#logTimeElapsed2").text(timeElapsed2.toFixed(2));
    $("#logMaxPowerRpm2").html(`<span id="max-power-unit-label-2">${formattedMaxPower2.unit}</span> @ ${rpmAtMaxPower2} rpm`);
    $("#logMaxTorqueRpm2").text(`Nm @ ${rpmAtMaxTorque2} rpm`);

    updatePowerUnitLabels();

    // Set initial cursor data to "-"
    $("#logPower1, #logTorque1, #logMotorSpeed1, #logPower2, #logTorque2, #logMotorSpeed2").text("-");

    // Update chart height for comparison mode
    if (apexChart) {
        apexChart.updateOptions({
            chart: { height: getChartHeight() }
        });
    }
}

/**
 * Clear comparison selection and return to single mode
 */
function clearComparisonSelection() {
    selectedLogs = [];
    isComparisonMode = false;
    updateUIForSingleLog();
}

// ========================================
// INITIALIZATION & LOG LOADING
// ========================================

document.addEventListener("DOMContentLoaded", initChart);

// ========================================
// LOG LIST MANAGEMENT
// ========================================

$(document).ready(function () {
    let deleteTargetId = null;
    let deleteTargetElement = null;

    const modalEl = document.getElementById('confirmDeleteModal');
    if (!modalEl) {
        console.error('confirmDeleteModal not found in DOM. Make sure the modal HTML is present.');
        return;
    }
    const confirmModal = new bootstrap.Modal(modalEl, { keyboard: true });

    /**
     * Load logs from server and populate list
     */
    function loadLogs() {
        $.getJSON("/api/logs", function (data) {
            const logList = $("#log-list").empty();
            // Reverse the array to show newest logs first
            data.slice().reverse().forEach(log => {
                logList.append(`
          <a href="#" class="list-group-item list-group-item-action position-relative d-flex align-items-start" data-id="${log.id}" data-name="${log.name}">
            <div class="flex-grow-1 me-3">
              <h5 class="mb-1 log-name text-truncate" data-full-text="${log.name}">${log.name}</h5>
              <p class="mb-1 log-comment text-truncate" data-full-text="${log.comment}">${log.comment}</p>
              <small class="text-body-secondary">${log.date}</small>
            </div>
            <button class="btn delete-btn border-0 text-danger flex-shrink-0" data-id="${log.id}" type="button" aria-label="Delete ${log.name}">
              <i class="bi bi-trash"></i>
            </button>
          </a>
        `);
            });
            // Initialize tooltips after logs are loaded
            setupTooltips();
        }).fail(function () {
            console.error('Failed to fetch logs');
        });
    }

    loadLogs();

    /**
     * Set up Bootstrap tooltips for truncated log names/comments
     */
    function setupTooltips() {
        // Dispose existing tooltips first
        $('.log-name, .log-comment').each(function () {
            const tooltip = bootstrap.Tooltip.getInstance(this);
            if (tooltip) {
                tooltip.dispose();
            }
        });

        // Initialize new tooltips
        $('.log-name, .log-comment').each(function () {
            const element = $(this);
            const fullText = element.data('full-text');
            // Add Bootstrap tooltip attributes
            element.attr('data-bs-toggle', 'tooltip').attr('title', fullText);
            // Initialize Bootstrap tooltip
            new bootstrap.Tooltip(element[0]);
        });
    }

    // ========================================
    // DELETE HANDLERS
    // ========================================

    // Delete button click - show confirmation modal
    $("#log-list").on("click", ".delete-btn", function (event) {
        event.stopPropagation();
        deleteTargetId = $(this).data("id");
        deleteTargetElement = $(this).closest('a');

        const title = deleteTargetElement.find('h5').text() || 'this log';
        const bodyText = `Are you sure you want to delete "${title}"? This action cannot be undone.`;
        $("#confirmDeleteModal .modal-body").text(bodyText);

        confirmModal.show();

        setTimeout(() => { document.getElementById('confirmDeleteBtn').focus(); }, 150);
    });

    // Confirm delete button - execute deletion
    $("#confirmDeleteBtn").on("click", function () {
        if (!deleteTargetId) return;

        const $confirmBtn = $("#confirmDeleteBtn");
        const $cancelBtn = $("#cancelDeleteBtn");
        $confirmBtn.prop('disabled', true);
        $cancelBtn.prop('disabled', true);

        $.ajax({
            url: `/api/logs/${deleteTargetId}`,
            type: "DELETE",
            success: function (response) {
                if (response && response.message === 'success') {
                    if (deleteTargetElement) deleteTargetElement.remove();
                    selectedLogs = selectedLogs.filter(log => log.id !== deleteTargetId);
                    if (selectedLogs.length < 2) {
                        clearComparisonSelection();
                    }
                } else {
                    alert("Could not delete log. Server response: " + JSON.stringify(response));
                }
            },
            error: function (xhr, status, err) {
                alert("Error deleting log: " + (xhr.responseText || status));
            },
            complete: function () {
                $confirmBtn.prop('disabled', false);
                $cancelBtn.prop('disabled', false);
                deleteTargetId = null;
                deleteTargetElement = null;
                confirmModal.hide();
            }
        });
    });

    $("#cancelDeleteBtn").on("click", function () {
        deleteTargetId = null;
        deleteTargetElement = null;
    });

    // ========================================
    // LOG SELECTION & COMPARISON
    // ========================================

    let currentSingleLog = null;

    // Log item click handler - single selection or Ctrl+click for comparison
    $(document).on("click", ".list-group-item", function (e) {
        e.preventDefault();
        const logId = $(this).data("id");
        const logName = $(this).data("name");

        if (e.ctrlKey || e.metaKey) {
            e.stopPropagation();

            if (!currentSingleLog && currentLogData1) {
                const activeLog = $("#log-list .list-group-item.active").first();
                if (activeLog.length > 0) {
                    const activeLogId = activeLog.data("id");
                    const activeLogName = activeLog.data("name");

                    if (activeLogId !== logId) {
                        selectedLogs = [
                            { id: activeLogId, name: activeLogName },
                            { id: logId, name: logName }
                        ];
                    } else {
                        selectedLogs = [{ id: logId, name: logName }];
                    }
                } else {
                    selectedLogs = [{ id: logId, name: logName }];
                }
            } else if (currentSingleLog && currentSingleLog.id !== logId) {
                selectedLogs = [
                    { id: currentSingleLog.id, name: currentSingleLog.name },
                    { id: logId, name: logName }
                ];
            } else {
                const index = selectedLogs.findIndex(log => log.id === logId);
                if (index === -1) {
                    selectedLogs.push({ id: logId, name: logName });
                } else {
                    selectedLogs.splice(index, 1);
                }
            }

            selectedLogs.forEach((log, idx) => {
                $(`[data-id="${log.id}"]`).addClass("active");
            });

            if (selectedLogs.length === 2) {
                $.when(
                    $.getJSON(`/api/logs/${selectedLogs[0].id}`),
                    $.getJSON(`/api/logs/${selectedLogs[1].id}`)
                ).done(function (log1Data, log2Data) {
                    updateComparisonChart(applyLogDisplayFilter(log1Data[0]), applyLogDisplayFilter(log2Data[0]));
                });
            } else if (selectedLogs.length === 1) {
                $.getJSON(`/api/logs/${selectedLogs[0].id}`, function(data) {
                    updateChartFromJSON(applyLogDisplayFilter(data));
                });
                currentSingleLog = selectedLogs[0];
            } else {
                // No logs selected - show empty state
                if (apexChart) {
                    apexChart.updateSeries([]);
                }
                clearComparisonSelection();
                currentSingleLog = null;

                // Show empty state and hide content
                $("#contentContainer").css('display', 'none');
                $("#emptyState").css('display', 'flex');
            }
        } else {
            // Clear visual selection from all items first
            $("#log-list .list-group-item").removeClass("active");
            clearComparisonSelection();
            currentSingleLog = { id: logId, name: logName };
            selectedLogs = [currentSingleLog];
            $(this).addClass("active");
            $.getJSON(`/api/logs/${logId}`, function(data) {
                updateChartFromJSON(applyLogDisplayFilter(data));
            });
        }
    });
});

// ========================================
// POWER UNIT HANDLERS
// ========================================

/**
 * Refresh chart when power unit changes
 * Reloads current log(s) with updated unit labels
 */
function refreshChartForUnitChange() {
    if (currentSingleLog) {
        // Reload single log with updated units
        $.getJSON(`/api/logs/${currentSingleLog.id}`, updateChartFromJSON);
    } else if (isComparisonMode && currentLogData1 && currentLogData2) {
        // Reload comparison with updated units
        if (apexChart?.opts?.xaxis?.title?.text?.includes('RPM')) {
            updateDynamicComparisonChart(currentLogData1, currentLogData2);
        } else {
            updateTimeBasedComparisonChart(currentLogData1, currentLogData2);
        }
    }
    updatePowerUnitLabels();
}

// Listen for power unit changes from power-units.js
window.addEventListener('powerUnitChanged', refreshChartForUnitChange);

// Listen for storage events from other tabs (cross-tab sync)
window.addEventListener('storage', function (e) {
    if (e.key === 'opendyno_power_unit' && e.newValue) {
        refreshChartForUnitChange();
    }
});

$(document).ready(function () {
    const logFilterToggle = getLogDisplayFilterToggle();
    if (logFilterToggle) {
        const saved = localStorage.getItem('opendyno_logs_display_filter');
        if (saved !== null) {
            logsDisplayFilterEnabled = saved === 'true';
            logFilterToggle.checked = logsDisplayFilterEnabled;
        }

        logFilterToggle.addEventListener('change', function () {
            logsDisplayFilterEnabled = this.checked;
            localStorage.setItem('opendyno_logs_display_filter', this.checked);

            if (currentLogData1 && !isComparisonMode) {
                const raw = JSON.parse(JSON.stringify(currentLogData1));
                updateChartFromJSON(applyLogDisplayFilter(raw));
            } else if (currentLogData1 && currentLogData2) {
                const raw1 = JSON.parse(JSON.stringify(currentLogData1));
                const raw2 = JSON.parse(JSON.stringify(currentLogData2));
                updateComparisonChart(applyLogDisplayFilter(raw1), applyLogDisplayFilter(raw2));
            }
        });
    }
});
