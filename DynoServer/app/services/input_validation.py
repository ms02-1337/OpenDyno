from __future__ import annotations
import re
import math
from copy import deepcopy
from typing import Any, Dict, Iterable, Mapping

# Input validation and sanitization for API payloads
class ValidationError(ValueError):
    """Raised when input payload validation fails."""

RUN_MODE_OPTIONS = ["Dynamic", "Torque", "Speed", "Dynamic debug"]

_CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]")
_INT_RE = re.compile(r"^[+-]?\d+$")

# Format keys
def _format_keys(keys: Iterable[str]) -> str:
    return ", ".join(sorted(keys))

# Ensure mapping
def _ensure_mapping(value: Any, field: str) -> Dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValidationError(f"{field} must be an object.")
    return dict(value)

# Validate keys
def _validate_keys(
    data: Mapping[str, Any],
    allowed_keys: Iterable[str],
    field: str,
    allow_partial: bool,
    required_keys: Iterable[str] | None = None,
) -> None:
    allowed = set(allowed_keys)
    unknown = set(data.keys()) - allowed
    if unknown:
        raise ValidationError(
            f"{field} has unexpected keys: {_format_keys(unknown)}. "
            f"Allowed keys: {_format_keys(allowed)}."
        )

    if allow_partial:
        return

    required = set(required_keys) if required_keys is not None else allowed
    missing = required - set(data.keys())
    if missing:
        raise ValidationError(f"{field} is missing required keys: {_format_keys(missing)}.")

# Convert to boolean
def _to_bool(value: Any, field: str) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if value in (0, 1):
            return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    raise ValidationError(f"{field} must be a boolean.")

# Convert to float
def _to_float(
    value: Any,
    field: str,
    min_value: float | None = None,
    max_value: float | None = None,
) -> float:
    if isinstance(value, bool):
        raise ValidationError(f"{field} must be a number.")

    parsed: float
    if isinstance(value, (int, float)):
        parsed = float(value)
    elif isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            raise ValidationError(f"{field} cannot be empty.")
        try:
            parsed = float(stripped)
        except ValueError as exc:
            raise ValidationError(f"{field} must be a valid number.") from exc
    else:
        raise ValidationError(f"{field} must be a number.")

    if not math.isfinite(parsed):
        raise ValidationError(f"{field} must be a finite number.")

    if min_value is not None and parsed < min_value:
        raise ValidationError(f"{field} must be >= {min_value}.")
    if max_value is not None and parsed > max_value:
        raise ValidationError(f"{field} must be <= {max_value}.")
    return parsed


def _to_int(
    value: Any,
    field: str,
    min_value: int | None = None,
    max_value: int | None = None,
) -> int:
    if isinstance(value, bool):
        raise ValidationError(f"{field} must be an integer.")

    parsed: int
    if isinstance(value, int):
        parsed = value
    elif isinstance(value, float):
        if not math.isfinite(value) or not value.is_integer():
            raise ValidationError(f"{field} must be an integer.")
        parsed = int(value)
    elif isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            raise ValidationError(f"{field} cannot be empty.")
        if _INT_RE.match(stripped):
            parsed = int(stripped)
        else:
            try:
                float_candidate = float(stripped)
            except ValueError as exc:
                raise ValidationError(f"{field} must be an integer.") from exc
            if not math.isfinite(float_candidate) or not float_candidate.is_integer():
                raise ValidationError(f"{field} must be an integer.")
            parsed = int(float_candidate)
    else:
        raise ValidationError(f"{field} must be an integer.")

    if min_value is not None and parsed < min_value:
        raise ValidationError(f"{field} must be >= {min_value}.")
    if max_value is not None and parsed > max_value:
        raise ValidationError(f"{field} must be <= {max_value}.")
    return parsed

# Convert to string
def _sanitize_text(
    value: Any,
    field: str,
    *,
    required: bool,
    max_len: int,
    allow_newlines: bool = False,
) -> str:
    if value is None:
        if required:
            raise ValidationError(f"{field} is required.")
        return ""

    text = str(value).strip()
    if required and not text:
        raise ValidationError(f"{field} cannot be empty.")
    if len(text) > max_len:
        raise ValidationError(f"{field} exceeds maximum length ({max_len}).")
    if _CONTROL_CHAR_RE.search(text):
        raise ValidationError(f"{field} contains control characters.")
    if "<" in text or ">" in text:
        raise ValidationError(f"{field} contains unsupported characters.")
    if not allow_newlines:
        text = text.replace("\r", " ").replace("\n", " ")
    return text

# Validate numeric section
def _validate_numeric_section(
    section_name: str,
    raw_section: Any,
    specs: Mapping[str, tuple[str, float | int | None, float | int | None]],
    allow_partial: bool,
) -> Dict[str, Any]:
    section = _ensure_mapping(raw_section, section_name)
    _validate_keys(section, specs.keys(), section_name, allow_partial)

    normalized: Dict[str, Any] = {}
    for field, (field_type, min_value, max_value) in specs.items():
        if field not in section:
            continue
        path = f"{section_name}.{field}"
        if field_type == "int":
            normalized[field] = _to_int(
                section[field],
                path,
                min_value=int(min_value) if min_value is not None else None,
                max_value=int(max_value) if max_value is not None else None,
            )
        elif field_type == "float":
            normalized[field] = _to_float(
                section[field],
                path,
                min_value=float(min_value) if min_value is not None else None,
                max_value=float(max_value) if max_value is not None else None,
            )
        else:
            raise ValidationError(f"Internal validator error: unsupported field type '{field_type}'.")
    return normalized

# Validate min lte max
def _validate_min_lte_max(
    section_name: str,
    data: Mapping[str, Any],
    min_field: str,
    max_field: str,
) -> None:
    if min_field in data and max_field in data and data[min_field] > data[max_field]:
        raise ValidationError(
            f"{section_name}.{min_field} cannot be greater than {section_name}.{max_field}."
        )

# Validate launch section
def _validate_launch_section(raw_section: Any, allow_partial: bool) -> Dict[str, Any]:
    specs = {
        "startSpeed": ("float", 0.0, 200000.0),
        "stableTime": ("float", 0.0, 600000.0),
        "endSpeed": ("float", 0.0, 200000.0),
        "rampRate": ("float", 0.0, 50000.0),
        "endHoldDelay": ("float", 0.0, 600000.0),
        "rampDownRate": ("float", 0.0, 50000.0),
        "finalSpeed": ("float", 0.0, 200000.0),
    }
    result = _validate_numeric_section("launch", raw_section, specs, allow_partial)
    _validate_min_lte_max("launch", result, "startSpeed", "endSpeed")
    if "finalSpeed" in result and "endSpeed" in result and result["finalSpeed"] > result["endSpeed"]:
        raise ValidationError("launch.finalSpeed cannot be greater than launch.endSpeed.")
    return result

# Validate speed limits section
def _validate_speed_limits_section(raw_section: Any, allow_partial: bool) -> Dict[str, Any]:
    specs = {
        "minSpeed": ("int", 0, 65535),
        "maxSpeed": ("int", 0, 65535),
    }
    result = _validate_numeric_section("speedLimits", raw_section, specs, allow_partial)
    _validate_min_lte_max("speedLimits", result, "minSpeed", "maxSpeed")
    return result

# Validate load cell section
def _validate_load_cell_section(raw_section: Any, allow_partial: bool) -> Dict[str, Any]:
    specs = {
        "gain": ("int", 1, 65535),
        "offset": ("int", 0, 65535),
        "scale": ("float", -1000000.0, 1000000.0),
        "distance": ("float", 0.001, 10.0),
    }
    result = _validate_numeric_section("loadCell", raw_section, specs, allow_partial)
    if "gain" in result and result["gain"] not in {64, 128}:
        raise ValidationError("loadCell.gain must be 64 or 128.")
    return result

# Validate inertia section
def _validate_inertia_section(raw_section: Any, allow_partial: bool) -> Dict[str, Any]:
    specs = {
        "dynoInertia": ("float", 0.0, 1000.0),
        "chainInertia": ("float", 0.0, 1000.0),
        "fanInertia": ("float", 0.0, 1000.0),
    }
    return _validate_numeric_section("inertiaAndLoads", raw_section, specs, allow_partial)

# Validate PID section
def _validate_pid_section(section_name: str, raw_section: Any, allow_partial: bool) -> Dict[str, Any]:
    specs = {
        "kp": ("float", 0.0, 10000.0),
        "ki": ("float", 0.0, 10000.0),
        "kd": ("float", 0.0, 10000.0),
    }
    return _validate_numeric_section(section_name, raw_section, specs, allow_partial)

# Validate ratio section
def _validate_ratio_section(raw_section: Any, allow_partial: bool) -> Dict[str, Any]:
    specs = {
        "motorPinions": ("int", 1, 1000),
        "dynoPinions": ("int", 1, 1000),
    }
    return _validate_numeric_section("ratio", raw_section, specs, allow_partial)

# Validate PWM section
def _validate_pwm_section(raw_section: Any, allow_partial: bool) -> Dict[str, Any]:
    specs = {
        "start": ("int", 0, 65535),
        "limit": ("int", 0, 65535),
        "frequency": ("int", 1, 50000),
    }
    result = _validate_numeric_section("pwm", raw_section, specs, allow_partial)
    _validate_min_lte_max("pwm", result, "start", "limit")
    return result

# Validate low pass section
def _validate_low_pass_section(raw_section: Any, allow_partial: bool) -> Dict[str, Any]:
    specs = {
        "speed": ("int", 0, 10000),
        "torque": ("int", 0, 10000),
        "acceleration": ("int", 0, 10000),
        "output": ("int", 0, 10000),
    }
    return _validate_numeric_section("low_pass_filters", raw_section, specs, allow_partial)

# Validate graph section
def _validate_graph_section(
    section_name: str,
    raw_section: Any,
    allow_partial: bool,
    include_speed: bool,
    include_power: bool,
    include_rpm: bool,
    include_pwm: bool,
    include_acc: bool,
) -> Dict[str, Any]:
    specs: Dict[str, tuple[str, float | int | None, float | int | None]] = {
        "max_points": ("int", 10, 200000),
        "torque_min": ("float", -1000000.0, 1000000.0),
        "torque_max": ("float", -1000000.0, 1000000.0),
    }
    if include_speed:
        specs["speed_min"] = ("float", -1000000.0, 1000000.0)
        specs["speed_max"] = ("float", -1000000.0, 1000000.0)
    if include_power:
        specs["power_min"] = ("float", -1000000.0, 1000000.0)
        specs["power_max"] = ("float", -1000000.0, 1000000.0)
    if include_rpm:
        specs["rpm_min"] = ("float", -1000000.0, 1000000.0)
        specs["rpm_max"] = ("float", -1000000.0, 1000000.0)
    if include_pwm:
        specs["pwm_min"] = ("float", 0.0, 65535.0)
        specs["pwm_max"] = ("float", 0.0, 65535.0)
    if include_acc:
        specs["acc_min"] = ("float", -1000000.0, 1000000.0)
        specs["acc_max"] = ("float", -1000000.0, 1000000.0)

    result = _validate_numeric_section(section_name, raw_section, specs, allow_partial)
    _validate_min_lte_max(section_name, result, "torque_min", "torque_max")
    _validate_min_lte_max(section_name, result, "speed_min", "speed_max")
    _validate_min_lte_max(section_name, result, "power_min", "power_max")
    _validate_min_lte_max(section_name, result, "rpm_min", "rpm_max")
    _validate_min_lte_max(section_name, result, "pwm_min", "pwm_max")
    _validate_min_lte_max(section_name, result, "acc_min", "acc_max")
    return result

# Validate run mode section
def _validate_run_mode_section(raw_section: Any, allow_partial: bool) -> Dict[str, Any]:
    section = _ensure_mapping(raw_section, "runMode")
    _validate_keys(section, {"options", "mode", "value", "rawValue"}, "runMode", allow_partial)

    normalized: Dict[str, Any] = {}
    if "mode" in section:
        normalized["mode"] = str(_to_int(section["mode"], "runMode.mode", 0, 3))
    if "value" in section:
        normalized["value"] = _to_int(section["value"], "runMode.value", 0, 65535)
    if "rawValue" in section:
        normalized["rawValue"] = _to_float(section["rawValue"], "runMode.rawValue", 0.0, 65535.0)

    if not allow_partial:
        for required in ("mode", "value", "rawValue"):
            if required not in normalized:
                raise ValidationError(f"runMode.{required} is required.")

    if (not allow_partial) or ("options" in section):
        normalized["options"] = list(RUN_MODE_OPTIONS)
    return normalized

# Validate debug section
def _validate_debug_section(raw_section: Any, allow_partial: bool) -> Dict[str, Any]:
    section = _ensure_mapping(raw_section, "debug")
    _validate_keys(section, {"enabled"}, "debug", allow_partial)

    normalized: Dict[str, Any] = {}
    if "enabled" in section:
        normalized["enabled"] = _to_bool(section["enabled"], "debug.enabled")
    return normalized

# Validate can interface section
def _validate_can_interface_section(raw_section: Any, allow_partial: bool) -> Dict[str, Any]:
    section = _ensure_mapping(raw_section, "canInterface")
    _validate_keys(section, {"mode", "channel", "bitrate"}, "canInterface", allow_partial)

    normalized: Dict[str, Any] = {}
    if "mode" in section:
        mode = _sanitize_text(section["mode"], "canInterface.mode", required=True, max_len=32).lower()
        if mode not in {"native", "slcan"}:
            raise ValidationError("canInterface.mode must be 'native' or 'slcan'.")
        normalized["mode"] = mode
    
    if "channel" in section:
        normalized["channel"] = _sanitize_text(section["channel"], "canInterface.channel", required=True, max_len=128)
        
    if "bitrate" in section:
        normalized["bitrate"] = _to_int(section["bitrate"], "canInterface.bitrate", 1000, 10000000)

    if not allow_partial:
        for required in ("mode", "channel", "bitrate"):
            if required not in normalized:
                raise ValidationError(f"canInterface.{required} is required.")

    return normalized

def _validate_display_filter_section(raw: Any) -> Dict[str, Any]:
    payload = _ensure_mapping(raw, "display_filter")
    normalized: Dict[str, Any] = {}
    if "enabled" in payload:
        normalized["enabled"] = _to_bool(payload["enabled"], "enabled")
    return normalized

# Section validators
_SECTION_VALIDATORS = {
    "launch": _validate_launch_section,
    "speedLimits": _validate_speed_limits_section,
    "loadCell": _validate_load_cell_section,
    "inertiaAndLoads": _validate_inertia_section,
    "torquePID": lambda raw, allow_partial: _validate_pid_section("torquePID", raw, allow_partial),
    "speedPID": lambda raw, allow_partial: _validate_pid_section("speedPID", raw, allow_partial),
    "dynamicPID": lambda raw, allow_partial: _validate_pid_section("dynamicPID", raw, allow_partial),
    "ratio": _validate_ratio_section,
    "pwm": _validate_pwm_section,
    "low_pass_filters": _validate_low_pass_section,
    "live_graph": lambda raw, allow_partial: _validate_graph_section(
        "live_graph",
        raw,
        allow_partial,
        include_speed=True,
        include_power=True,
        include_rpm=False,
        include_pwm=False,
        include_acc=False,
    ),
    "speed_graph": lambda raw, allow_partial: _validate_graph_section(
        "speed_graph",
        raw,
        allow_partial,
        include_speed=True,
        include_power=True,
        include_rpm=False,
        include_pwm=False,
        include_acc=False,
    ),
    "torque_graph": lambda raw, allow_partial: _validate_graph_section(
        "torque_graph",
        raw,
        allow_partial,
        include_speed=True,
        include_power=True,
        include_rpm=False,
        include_pwm=False,
        include_acc=False,
    ),
    "dynamic_graph": lambda raw, allow_partial: _validate_graph_section(
        "dynamic_graph",
        raw,
        allow_partial,
        include_speed=False,
        include_power=True,
        include_rpm=True,
        include_pwm=False,
        include_acc=False,
    ),
    "debug_graph": lambda raw, allow_partial: _validate_graph_section(
        "debug_graph",
        raw,
        allow_partial,
        include_speed=True,
        include_power=False,
        include_rpm=False,
        include_pwm=True,
        include_acc=True,
    ),
    "runMode": _validate_run_mode_section,
    "debug": _validate_debug_section,
    "canInterface": _validate_can_interface_section,
    "display_filter": lambda raw, allow_partial: _validate_display_filter_section(raw),
}

# Sanitize config patch
def _sanitize_config_patch(raw_payload: Any) -> Dict[str, Any]:
    payload = _ensure_mapping(raw_payload, "payload")
    allowed_top_keys = set(_SECTION_VALIDATORS.keys()) | {"checksum"}
    _validate_keys(payload, allowed_top_keys, "payload", allow_partial=True)

    patch: Dict[str, Any] = {}
    for section_name, section_value in payload.items():
        if section_name == "checksum":
            continue
        validator = _SECTION_VALIDATORS[section_name]
        patch[section_name] = validator(section_value, True)

    if not patch:
        raise ValidationError("No updatable configuration sections were provided.")
    return patch

# Merge patch
def _merge_patch(base_config: Mapping[str, Any], patch: Mapping[str, Any]) -> Dict[str, Any]:
    merged: Dict[str, Any] = deepcopy(dict(base_config))
    for section_name, section_patch in patch.items():
        if isinstance(section_patch, Mapping):
            base_section = merged.get(section_name, {})
            if not isinstance(base_section, Mapping):
                base_section = {}
            merged[section_name] = dict(base_section)
            merged[section_name].update(deepcopy(dict(section_patch)))
        else:
            merged[section_name] = deepcopy(section_patch)
    return merged

# Normalize complete config
def _normalize_complete_config(config: Mapping[str, Any]) -> Dict[str, Any]:
    normalized: Dict[str, Any] = {}
    for key, value in config.items():
        if key == "checksum":
            continue
        if key in _SECTION_VALIDATORS:
            normalized[key] = _SECTION_VALIDATORS[key](value, False)
        else:
            normalized[key] = deepcopy(value)

    missing_required = set(_SECTION_VALIDATORS.keys()) - set(normalized.keys())
    if missing_required:
        raise ValidationError(
            f"Configuration is missing required sections: {_format_keys(missing_required)}."
        )
    return normalized

# Validate full config payload
def validate_full_config_payload(raw_payload: Any, current_config: Mapping[str, Any]) -> Dict[str, Any]:
    if not isinstance(current_config, Mapping):
        raise ValidationError("Current configuration is invalid on the server.")
    patch = _sanitize_config_patch(raw_payload)
    merged = _merge_patch(current_config, patch)
    return _normalize_complete_config(merged)

# Validate fast config payload
def validate_fast_config_payload(raw_payload: Any, current_config: Mapping[str, Any]) -> Dict[str, Any]:
    if not isinstance(current_config, Mapping):
        raise ValidationError("Current configuration is invalid on the server.")
    patch = _sanitize_config_patch(raw_payload)
    merged = _merge_patch(current_config, patch)
    normalized_complete = _normalize_complete_config(merged)
    return {section_name: normalized_complete[section_name] for section_name in patch.keys()}

# Validate live update payload
def validate_live_update_payload(raw_payload: Any) -> int:
    payload = _ensure_mapping(raw_payload, "payload")
    _validate_keys(payload, {"enabled"}, "payload", allow_partial=False)
    return 1 if _to_bool(payload["enabled"], "enabled") else 0

# Validate PWM update payload
def validate_pwm_update_payload(
    raw_payload: Any,
    *,
    min_pwm: int = 0,
    max_pwm: int = 65535,
) -> int:
    payload = _ensure_mapping(raw_payload, "payload")
    _validate_keys(payload, {"pwm_value"}, "payload", allow_partial=False)
    if min_pwm > max_pwm:
        raise ValidationError("Server PWM limits are invalid (min greater than max).")
    return _to_int(payload["pwm_value"], "pwm_value", min_pwm, max_pwm)

# Validate log payload
def validate_log_payload(raw_payload: Any) -> Dict[str, Any]:
    payload = _ensure_mapping(raw_payload, "payload")
    required_keys = {
        "name",
        "comment",
        "date",
        "max_torque",
        "max_power",
        "time_elapsed",
        "run_mode",
        "value",
        "motor_ratio",
        "dyno_ratio",
        "data",
    }
    optional_keys = {"start_speed", "end_speed", "ramp_time", "id"}
    _validate_keys(
        payload,
        required_keys | optional_keys,
        "payload",
        allow_partial=False,
        required_keys=required_keys,
    )

    normalized: Dict[str, Any] = {}
    if "id" in payload:
        normalized["id"] = _to_int(payload["id"], "id", 1, 2147483647)

    normalized["name"] = _sanitize_text(payload["name"], "name", required=True, max_len=120)
    normalized["comment"] = _sanitize_text(
        payload["comment"],
        "comment",
        required=False,
        max_len=4000,
        allow_newlines=True,
    )
    normalized["date"] = _sanitize_text(payload["date"], "date", required=True, max_len=64)
    normalized["max_torque"] = _to_float(payload["max_torque"], "max_torque", -1000000.0, 1000000.0)
    normalized["max_power"] = _to_float(payload["max_power"], "max_power", -1000000.0, 1000000.0)
    normalized["time_elapsed"] = _to_float(payload["time_elapsed"], "time_elapsed", 0.0, 86400.0)
    normalized["value"] = _to_float(payload["value"], "value", -1000000.0, 1000000.0)
    normalized["motor_ratio"] = _to_float(payload["motor_ratio"], "motor_ratio", 0.0, 1000.0)
    normalized["dyno_ratio"] = _to_float(payload["dyno_ratio"], "dyno_ratio", 0.0, 1000.0)

    run_mode = _sanitize_text(payload["run_mode"], "run_mode", required=True, max_len=32).lower()
    if run_mode in {"dynamic debug", "dynamic_debug"}:
        run_mode = "dynamic"
    if run_mode == "default":
        run_mode = "speed"
    if run_mode not in {"dynamic", "speed", "torque"}:
        raise ValidationError("run_mode must be one of: dynamic, speed, torque, default.")
    normalized["run_mode"] = run_mode

    data_points_raw = payload["data"]
    if not isinstance(data_points_raw, list):
        raise ValidationError("data must be an array of points.")
    if not data_points_raw:
        raise ValidationError("data must contain at least one point.")
    if len(data_points_raw) > 200000:
        raise ValidationError("data contains too many points.")

    normalized_points = []
    for idx, point in enumerate(data_points_raw):
        point_path = f"data[{idx}]"
        point_obj = _ensure_mapping(point, point_path)
        _validate_keys(point_obj, {"timestamp", "rpm", "torque", "power"}, point_path, allow_partial=True)

        if "rpm" not in point_obj or "torque" not in point_obj or "power" not in point_obj:
            raise ValidationError(f"{point_path} must contain rpm, torque, and power.")

        normalized_point = {
            "rpm": _to_float(point_obj["rpm"], f"{point_path}.rpm", 0.0, 200000.0),
            "torque": _to_float(point_obj["torque"], f"{point_path}.torque", -1000000.0, 1000000.0),
            "power": _to_float(point_obj["power"], f"{point_path}.power", -1000000.0, 1000000.0),
        }
        if "timestamp" in point_obj:
            normalized_point["timestamp"] = _to_float(
                point_obj["timestamp"], f"{point_path}.timestamp", 0.0, 4294967295.0
            )
        normalized_points.append(normalized_point)

    if run_mode != "dynamic":
        for idx, point in enumerate(normalized_points):
            if "timestamp" not in point:
                raise ValidationError(f"data[{idx}].timestamp is required for non-dynamic logs.")

    normalized["data"] = normalized_points

    if run_mode == "dynamic":
        for field in ("start_speed", "end_speed", "ramp_time"):
            if field not in payload:
                raise ValidationError(f"{field} is required for dynamic logs.")
            normalized[field] = _to_float(payload[field], field, 0.0, 200000.0)
    else:
        for field in ("start_speed", "end_speed", "ramp_time"):
            if field in payload:
                normalized[field] = _to_float(payload[field], field, 0.0, 200000.0)

    return normalized
