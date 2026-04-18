#pragma once

#include "esp_err.h"
#include "esp_adc/adc_oneshot.h"
#include "driver/gpio.h"

// --- Pin / ADC Configuration ---
// GPIO15 = ADC2 channel 4 on ESP32-S3
#define THERM_ADC_CHANNEL       ADC_CHANNEL_4
#define THERM_ADC_UNIT          ADC_UNIT_2
#define THERM_ENABLE_GPIO       GPIO_NUM_17

// --- Circuit ---
#define THERM_SERIES_RESISTOR   10200.0f
#define THERM_ADC_MAX           4095.0f
#define THERM_VCC_CIRCUIT       5.0f    // thermistor divider supply voltage
#define THERM_VCC_ADC           3.3f    // ESP32 ADC reference voltage

// --- Steinhart-Hart coefficients (calibrated: 41.2F/77F/110.8F) ---
#define THERM_SH_A   1.371214487e-3f
#define THERM_SH_B   1.985848244e-4f
#define THERM_SH_C   1.968064247e-7f

esp_err_t thermistor_init(adc_oneshot_unit_handle_t adc_handle);
esp_err_t thermistor_read(float *temp_c_out);
