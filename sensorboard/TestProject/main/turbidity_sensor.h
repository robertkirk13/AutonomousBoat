#pragma once

#include "esp_err.h"
#include "esp_adc/adc_oneshot.h"
#include "driver/gpio.h"

// --- Pin / ADC Configuration ---
// GPIO4 = ADC1 channel 3 on ESP32-S3
#define TURB_ADC_CHANNEL        ADC_CHANNEL_3
#define TURB_ADC_UNIT           ADC_UNIT_1
#define TURB_ENABLE_GPIO        GPIO_NUM_5

// Valid sensor voltage range for NTU formula (datasheet, 5V supply)
#define TURB_VOLTAGE_MIN        2.5f    // V — above ~3000 NTU
#define TURB_VOLTAGE_MAX        4.3f    // V — 0 NTU (clear)

esp_err_t turbidity_sensor_init(adc_oneshot_unit_handle_t adc_handle);

/**
 * @brief Read the current turbidity.
 *
 * @param ntu_out      Output turbidity in NTU (0 = clear). May be NULL.
 * @param voltage_out  Output reconstructed sensor voltage in V. May be NULL.
 */
esp_err_t turbidity_sensor_read(float *ntu_out, float *voltage_out);
