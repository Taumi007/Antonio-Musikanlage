"""Constants."""

DOMAIN = "musikanlage"
CONF_TOPOLOGY = "topology"

SERVICE_ROUTE = "route"
SERVICE_STOP = "stop"
SERVICE_PLAN = "plan"

ATTR_ZONES = "zones"
ATTR_SOURCE = "source"  # "mixer:<interface>" or "radio:<favourite name>"
ATTR_INPUT = "input"
ATTR_PRESET = "preset"
ATTR_MIC = "mic"
ATTR_DRY_RUN = "dry_run"

# Device feedback timeouts (safety net only; normal completion is the state change)
TIMEOUT_VOLUME = 5.0
TIMEOUT_TRANSPORT = 10.0
TIMEOUT_GROUP = 10.0
TIMEOUT_MIXER = 3.0
VOLUME_TOLERANCE = 0.011
RAMP_STEP_SECONDS = 0.2

SIGNAL_ROUTE_UPDATED = f"{DOMAIN}_route_updated"
