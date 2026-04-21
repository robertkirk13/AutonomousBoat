# Scripts

Helper scripts for provisioning, hardware bring-up, and service-side utilities. Most of these are meant to run on the Raspberry Pi after the hardware is connected.

## Main Groups

- Provisioning: `flash-sd.sh`
- Power and sensors: `check_ina228.py`, `read_ina228.py`, `read_imu.py`, `read_temp.py`, `check_gps.py`
- Display helpers: `check_ssd1306.py`, `ssd1306.py`, `ssd1306_shutdown.py`, `reset_ssd1306.py`
- CAN helpers: `check_can.py`, `listen_can.py`
- Camera helper: `camera_stream.py`
- GPIO and stress tests: `toggle_gpio21.py`, `toggle_all_gpios.py`, `cpu_load.py`, `debug_i2c.py`

## Usage Notes

- Run the provisioning script from the repo root on macOS:

```bash
./scripts/flash-sd.sh
```

- Run the Python diagnostics from the repo root so relative imports and paths behave the same way as the docs:

```bash
python3 scripts/check_ina228.py
```

- `check_ssd1306.py` depends on `ssd1306.py`, which is why the OLED service uses `WorkingDirectory=/home/<user>/AutonomousBoat/scripts`.

See [`../docs/setup.md`](../docs/setup.md) and [`../docs/DEPLOY.md`](../docs/DEPLOY.md) for the full provisioning and deployment workflow.
