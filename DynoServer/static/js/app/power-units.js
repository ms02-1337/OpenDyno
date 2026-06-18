/**
 * power-units.js - Power Units Module
 *
 * Provides power unit conversion (kW/HP) and user preference management.
 * All backend data remains in kW - conversion happens only for display.
 */

const POWER_UNITS = {
  KW: 'kW',
  HP: 'HP'
};

const CONVERSION_FACTOR = 1.34102; // 1 kW = 1.34102 HP
const STORAGE_KEY = 'opendyno_power_unit';
const DEFAULT_UNIT = POWER_UNITS.KW;

/**
 * Convert kW to HP
 */
function kWtoHP(kW) {
  return kW * CONVERSION_FACTOR;
}

/**
 * Convert HP to kW
 */
function HPtoKw(hp) {
  return hp / CONVERSION_FACTOR;
}

/**
 * Get the current power unit from localStorage
 */
function getPowerUnit() {
  const unit = localStorage.getItem(STORAGE_KEY);
  if (unit === POWER_UNITS.KW || unit === POWER_UNITS.HP) {
    return unit;
  }
  // Set default if not found
  localStorage.setItem(STORAGE_KEY, DEFAULT_UNIT);
  return DEFAULT_UNIT;
}

/**
 * Set the power unit and save to localStorage
 */
function setPowerUnit(unit) {
  if (unit !== POWER_UNITS.KW && unit !== POWER_UNITS.HP) {
    console.error(`Invalid power unit: ${unit}. Must be 'kW' or 'HP'`);
    return;
  }
  const oldUnit = getPowerUnit();
  localStorage.setItem(STORAGE_KEY, unit);

  // Trigger custom event for listeners
  const event = new CustomEvent('powerUnitChanged', {
    detail: { oldUnit, newUnit: unit }
  });
  window.dispatchEvent(event);
}

/**
 * Format a power value with the current unit
 */
function formatPower(valueKW, unit = null, decimals = 2) {
  const targetUnit = unit || getPowerUnit();
  let value;

  if (targetUnit === POWER_UNITS.HP) {
    value = kWtoHP(valueKW);
  } else {
    value = valueKW;
  }

  return `${value.toFixed(decimals)} ${targetUnit}`;
}

/**
 * Convert a power value to the specified unit
 */
function convertPower(valueKW, unit = null) {
  const targetUnit = unit || getPowerUnit();

  if (targetUnit === POWER_UNITS.HP) {
    return kWtoHP(valueKW);
  }
  return valueKW;
}

/**
 * Get the conversion factor for the current unit
 */
function getConversionFactor(unit = null) {
  const targetUnit = unit || getPowerUnit();
  return targetUnit === POWER_UNITS.HP ? CONVERSION_FACTOR : 1;
}

// Initialize navbar dropdown on page load
document.addEventListener('DOMContentLoaded', function () {
  const dropdown = document.getElementById('powerUnitDropdown');
  const currentUnitSpan = document.getElementById('currentPowerUnit');
  const dropdownItems = document.querySelectorAll('[data-power-unit]');

  if (dropdown && currentUnitSpan) {
    // Set initial unit display
    currentUnitSpan.textContent = getPowerUnit();

    // Add click handlers to dropdown items
    dropdownItems.forEach(item => {
      item.addEventListener('click', function (e) {
        e.preventDefault();
        const unit = this.getAttribute('data-power-unit');
        setPowerUnit(unit);
        currentUnitSpan.textContent = unit;
      });
    });
  }
});

// Listen for storage events from other tabs
window.addEventListener('storage', function (e) {
  if (e.key === STORAGE_KEY && e.newValue) {
    const currentUnitSpan = document.getElementById('currentPowerUnit');
    if (currentUnitSpan) {
      currentUnitSpan.textContent = e.newValue;
    }
  }
});

// Export functions for use in other modules
window.PowerUnits = {
  POWER_UNITS,
  CONVERSION_FACTOR,
  kWtoHP,
  HPtoKw,
  getPowerUnit,
  setPowerUnit,
  formatPower,
  convertPower,
  getConversionFactor
};
