#!/usr/bin/env python3

import argparse
import os
import signal
import subprocess
import sys
import time

import gpiod


GPIO_CHIP = os.environ.get("ESTOP_GPIOCHIP", "/dev/gpiochip0")
GPIO_LINE = int(os.environ.get("ESTOP_GPIO", "5"))
ACTIVE_STATE = os.environ.get("ESTOP_ACTIVE_STATE", "high").strip().lower()
BIAS_NAME = os.environ.get("ESTOP_BIAS", "pull-up").strip().lower()
DEBOUNCE_MS = int(os.environ.get("ESTOP_DEBOUNCE_MS", "50"))
POLL_MS = int(os.environ.get("ESTOP_POLL_MS", "25"))
TARGET_SERVICE = os.environ.get("ESTOP_SERVICE", "boat-firmware.service")

STOP_REQUESTED = False


def log(message: str) -> None:
    print(message, flush=True)


def handle_signal(signum, _frame) -> None:
    global STOP_REQUESTED
    STOP_REQUESTED = True
    log(f"Received signal {signum}, stopping e-stop monitor")


def parse_bias():
    if BIAS_NAME in {"", "as-is", "disable", "disabled", "none"}:
        return None
    if BIAS_NAME == "pull-up":
        return gpiod.line.Bias.PULL_UP
    if BIAS_NAME == "pull-down":
        return gpiod.line.Bias.PULL_DOWN
    raise ValueError(
        f"Unsupported ESTOP_BIAS={BIAS_NAME!r}; expected pull-up, pull-down, or as-is"
    )


def active_when_raw_high() -> bool:
    if ACTIVE_STATE == "high":
        return True
    if ACTIVE_STATE == "low":
        return False
    raise ValueError(
        f"Unsupported ESTOP_ACTIVE_STATE={ACTIVE_STATE!r}; expected high or low"
    )


def request_line():
    settings_kwargs = {"direction": gpiod.line.Direction.INPUT}
    bias = parse_bias()
    if bias is not None:
        settings_kwargs["bias"] = bias

    return gpiod.request_lines(
        GPIO_CHIP,
        consumer="boat-estop",
        config={GPIO_LINE: gpiod.LineSettings(**settings_kwargs)},
    )


def estop_is_active(request) -> bool:
    raw_value = request.get_value(GPIO_LINE)
    raw_is_high = raw_value == gpiod.line.Value.ACTIVE
    return raw_is_high if active_when_raw_high() else not raw_is_high


def run_systemctl(action: str) -> int:
    result = subprocess.run(
        ["systemctl", "--no-block", action, TARGET_SERVICE],
        check=False,
    )
    return result.returncode


def wait_until_released() -> int:
    request = request_line()
    try:
        if not estop_is_active(request):
            return 0

        log(
            f"E-stop is asserted on GPIO{GPIO_LINE}; waiting for release before starting "
            f"{TARGET_SERVICE}"
        )
        while not STOP_REQUESTED:
            if not estop_is_active(request):
                log("E-stop released; service start may continue")
                return 0
            time.sleep(POLL_MS / 1000.0)
    finally:
        request.release()

    return 130


def reconcile(active: bool) -> None:
    if active:
        log(f"E-stop asserted on GPIO{GPIO_LINE}; stopping {TARGET_SERVICE}")
        rc = run_systemctl("stop")
        if rc != 0:
            log(f"Warning: systemctl stop {TARGET_SERVICE} exited with {rc}")
    else:
        log(f"E-stop released on GPIO{GPIO_LINE}; starting {TARGET_SERVICE}")
        rc = run_systemctl("start")
        if rc != 0:
            log(f"Warning: systemctl start {TARGET_SERVICE} exited with {rc}")


def monitor() -> int:
    debounce_s = max(DEBOUNCE_MS, 0) / 1000.0
    poll_s = max(POLL_MS, 1) / 1000.0

    request = request_line()
    try:
        stable_state = estop_is_active(request)
        pending_state = stable_state
        pending_since = time.monotonic()

        log(
            "Watching e-stop on "
            f"{GPIO_CHIP}:{GPIO_LINE} (active {ACTIVE_STATE}, bias {BIAS_NAME})"
        )
        reconcile(stable_state)

        while not STOP_REQUESTED:
            current_state = estop_is_active(request)
            now = time.monotonic()

            if current_state != pending_state:
                pending_state = current_state
                pending_since = now
            elif current_state != stable_state and now - pending_since >= debounce_s:
                stable_state = current_state
                reconcile(stable_state)

            time.sleep(poll_s)
    finally:
        request.release()

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Monitor a Raspberry Pi GPIO e-stop and stop/start a systemd service."
    )
    parser.add_argument(
        "mode",
        choices=("monitor", "wait-release"),
        help="Run the long-lived monitor or block until the e-stop is released.",
    )
    args = parser.parse_args()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    try:
        if args.mode == "wait-release":
            return wait_until_released()
        return monitor()
    except KeyboardInterrupt:
        return 130
    except Exception as exc:
        log(f"E-stop helper failed: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
