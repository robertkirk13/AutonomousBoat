#pragma once

#include "esp_err.h"
#include "esp_adc/adc_oneshot.h"
#include "driver/gpio.h"

// --- Pin / ADC Configuration ---
// GPIO18 = ADC2 channel 7 on ESP32-S3
#define PH_ADC_CHANNEL          ADC_CHANNEL_7
#define PH_ADC_UNIT             ADC_UNIT_2
#define PH_ENABLE_GPIO          GPIO_NUM_8

// --- Default Calibration (DFRobot Gravity V2) ---
#define PH_NEUTRAL_MV_DEFAULT   1500.0f   // mV at pH 7.0
#define PH_ACID_MV_DEFAULT      2030.0f   // mV at pH 4.0

/**
 * @brief Initialize the pH sensor.
 *
 * Configures the enable GPIO and registers PH_ADC_CHANNEL on the
 * supplied ADC unit handle (shared with other sensors on ADC_UNIT_2).
 * Also loads calibration from NVS if available.
 *
 * @param adc_handle  Pre-created adc_oneshot unit handle for ADC_UNIT_2.
 */
esp_err_t ph_sensor_init(adc_oneshot_unit_handle_t adc_handle);

/**
 * @brief Read the current pH value.
 *
 * Averages multiple ADC samples to reduce noise, then applies the
 * two-point linear calibration to compute pH.
 *
 * @param ph_out         Output pH value (may be NULL).
 * @param voltage_mv_out Output raw voltage in mV (may be NULL).
 */
esp_err_t ph_sensor_read(float *ph_out, float *voltage_mv_out);

/**
 * @brief Capture a calibration point from the current probe voltage.
 *
 * Auto-detects which buffer solution is in use:
 *   - 1300–1700 mV  → pH 7.0 (neutral)
 *   - otherwise     → pH 4.0 (acid)
 *
 * Saves the result to NVS immediately.
 */
esp_err_t ph_sensor_calibrate(void);

/** @brief Persist current calibration to NVS. */
esp_err_t ph_sensor_save_calibration(void);

/** @brief Load calibration from NVS (called automatically by ph_sensor_init). */
esp_err_t ph_sensor_load_calibration(void);
