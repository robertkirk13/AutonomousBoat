/*
 * dfrobot_ec.h
 *
 * Pure C driver for Gravity: Analog Electrical Conductivity Sensor V2 (K=1.0)
 * SKU: DFR0300
 *
 * Converted from the DFRobot Arduino C++ library for use with ESP-IDF.
 * Uses NVS for calibration storage instead of Arduino EEPROM.
 *
 * Original: https://github.com/DFRobot/DFRobot_EC
 * Copyright DFRobot, 2018 (GNU Lesser General Public License)
 */

#ifndef DFROBOT_EC_H
#define DFROBOT_EC_H

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* EC sensor context -- holds calibration state */
typedef struct {
    float kvalue_low;   /* K value for low range (<=2ms/cm) */
    float kvalue_high;  /* K value for high range (>2ms/cm) */
    float kvalue;       /* currently active K value */
    float voltage;      /* last voltage reading (mV) */
    float temperature;  /* last temperature reading (C) */
    float raw_ec;       /* raw EC before temp compensation */
    float ec_value;     /* final EC value (ms/cm) */
} dfrobot_ec_t;

/*
 * Initialize the EC sensor context and load calibration from NVS.
 * Call this once at startup.
 * Returns ESP_OK on success.
 */
int dfrobot_ec_begin(dfrobot_ec_t *ec);

/*
 * Convert an analog voltage reading to an EC value with temperature compensation.
 *
 * voltage:     voltage from ADC in mV
 * temperature: water temperature in degrees C
 *
 * Returns the EC value in ms/cm.
 */
float dfrobot_ec_read(dfrobot_ec_t *ec, float voltage, float temperature);

/*
 * Run calibration using a serial command string.
 *
 * voltage:     current voltage from ADC in mV
 * temperature: current water temperature in degrees C
 * cmd:         command string: "enterec", "calec", or "exitec"
 *
 * "enterec" -- enter calibration mode
 * "calec"   -- calibrate with standard buffer (auto-detects 1413us/cm or 12.88ms/cm)
 * "exitec"  -- save calibration to NVS and exit calibration mode
 */
void dfrobot_ec_calibration(dfrobot_ec_t *ec, float voltage, float temperature, const char *cmd);

#ifdef __cplusplus
}
#endif

#endif /* DFROBOT_EC_H */
