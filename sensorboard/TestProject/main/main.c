/*
Build command: idf.py build
flash command: idf.py flash
serial port monitor: idf.py monitor

flash works if you set flash port to what it needs to be and set target correctly
after setting port and target using the extension commands, the idf.py commands should work
*/


#include <stdio.h>
#include <math.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_log.h"


// ---------- User Parameters ----------
#define THERM_PIN             ADC_CHANNEL_4   // GPIO15/channel4 = T1, GPIO16/channel5 = T2
#define TEMP_EN               GPIO_NUM_17
#define SERIES_RESISTOR       10200.0f
#define NOMINAL_RESISTANCE    10000.0f
#define NOMINAL_TEMPERATURE   25.0f
#define BETA_COEFFICIENT      3950.0f
#define ADC_MAX               4095
#define VCC                   5.0f
// -------------------------------------

static const char *TAG = "THERMISTOR";

void app_main(void)
{
    // --- GPIO setup ---
    gpio_reset_pin(TEMP_EN);
    gpio_set_direction(TEMP_EN, GPIO_MODE_OUTPUT);
    gpio_set_level(TEMP_EN, 1);  // held HIGH permanently for now

    // --- ADC setup ---
    adc_oneshot_unit_handle_t adc_handle;
    adc_oneshot_unit_init_cfg_t unit_cfg = {
        .unit_id = ADC_UNIT_2,
    };
    adc_oneshot_new_unit(&unit_cfg, &adc_handle);

    adc_oneshot_chan_cfg_t chan_cfg = {
        .atten    = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_12,
    };
    adc_oneshot_config_channel(adc_handle, THERM_PIN, &chan_cfg);
    //adc2_config_channel_atten(ADC2_CHANNEL_4, ADC_ATTEN_DB_12);


    vTaskDelay(pdMS_TO_TICKS(1000));
    ESP_LOGI(TAG, "ESP32-S3 Thermistor Reader Started");

    gpio_dump_io_configuration(stdout, SOC_GPIO_VALID_GPIO_MASK);

    while (1) {
        int adcValue = 0;
        //adc_oneshot_read(adc_handle, THERM_PIN, &adcValue);
        //adc2_get_raw(ADC2_CHANNEL_4, ADC_WIDTH_BIT_12, &adcValue);
        esp_err_t ret = adc_oneshot_read(adc_handle, THERM_PIN, &adcValue);
        if (ret != ESP_OK) {
            ESP_LOGE(TAG, "ADC read failed: %s", esp_err_to_name(ret));
            vTaskDelay(pdMS_TO_TICKS(500));
            continue;
        }

        float voltage = (adcValue * VCC) / ADC_MAX;

        if (voltage <= 0.001f) {
            ESP_LOGW(TAG, "Voltage too low, skipping...");
            vTaskDelay(pdMS_TO_TICKS(500));
            continue;
        }

        float resistance = SERIES_RESISTOR * ((VCC / voltage) - 1.0f);

        float steinhart  = logf(resistance / NOMINAL_RESISTANCE);
        steinhart       /= BETA_COEFFICIENT;
        steinhart       += 1.0f / (NOMINAL_TEMPERATURE + 273.15f);
        float tempC      = (1.0f / steinhart) - 273.15f;

        ESP_LOGI(TAG, "ADC: %d | Voltage: %.3f V | Resistance: %.1f ohm | Temp: %.2f C",
                 adcValue, voltage, resistance, tempC);

        vTaskDelay(pdMS_TO_TICKS(500));
    }
}