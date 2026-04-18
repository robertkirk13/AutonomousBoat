#pragma once

#include "esp_err.h"
#include "esp_adc/adc_oneshot.h"
#include "driver/gpio.h"

// --- Pin / ADC Configuration ---
// GPIO6 = ADC1 channel 5 on ESP32-S3
#define EC_ADC_CHANNEL      ADC_CHANNEL_5
#define EC_ADC_UNIT         ADC_UNIT_1
#define EC_ENABLE_GPIO      GPIO_NUM_7

/**
 * @brief Initialize the EC sensor.
 *
 * Configures the enable GPIO and registers EC_ADC_CHANNEL on the
 * supplied ADC1 handle.
 *
 * @param adc_handle  Pre-created adc_oneshot unit handle for ADC_UNIT_1.
 */
esp_err_t ec_sensor_init(adc_oneshot_unit_handle_t adc_handle);

/**
 * @brief Read the current EC value.
 *
 * @param temperature   Water temperature in °C for compensation (use 25.0 if unknown).
 * @param ec_out        Output EC value in ms/cm.
 * @param voltage_mv_out Output raw voltage in mV (may be NULL).
 */
esp_err_t ec_sensor_read(float temperature, float *ec_out, float *voltage_mv_out);
