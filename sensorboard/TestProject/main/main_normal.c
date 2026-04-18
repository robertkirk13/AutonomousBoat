/*
Build command: idf.py build
flash command: idf.py flash
serial port monitor: idf.py monitor
*/

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "thermistor.h"
#include "ph_sensor.h"
#include "ec_sensor.h"
#include "turbidity_sensor.h"
#include "can_bus.h"
#include "sonar_sensor.h"
#include "sensor_data.h"
#include "wifi_ap.h"
#include "web_server.h"

static const char *TAG = "MAIN";

void app_main(void)
{
    // --- NVS init ---
    // Note: do NOT erase NVS here — calibration data is stored there
    nvs_flash_init();

    // --- Shared sensor data (must be before WiFi/web server) ---
    sensor_data_init();

    // --- WiFi AP + web dashboard ---
    wifi_ap_init();
    web_server_init();

    // --- ADC_UNIT_2: thermistor (GPIO15) + pH (GPIO18) ---
    adc_oneshot_unit_handle_t adc2_handle;
    adc_oneshot_unit_init_cfg_t unit2_cfg = { .unit_id = ADC_UNIT_2 };
    adc_oneshot_new_unit(&unit2_cfg, &adc2_handle);

    // --- ADC_UNIT_1: EC sensor (GPIO6) + turbidity (GPIO4) ---
    adc_oneshot_unit_handle_t adc1_handle;
    adc_oneshot_unit_init_cfg_t unit1_cfg = { .unit_id = ADC_UNIT_1 };
    adc_oneshot_new_unit(&unit1_cfg, &adc1_handle);

    // --- Init sensors ---
    if (thermistor_init(adc2_handle) != ESP_OK) {
        ESP_LOGE(TAG, "Thermistor init failed");
    }
    if (ph_sensor_init(adc2_handle) != ESP_OK) {
        ESP_LOGE(TAG, "pH sensor init failed");
    }
    if (ec_sensor_init(adc1_handle) != ESP_OK) {
        ESP_LOGE(TAG, "EC sensor init failed");
    }
    if (turbidity_sensor_init(adc1_handle) != ESP_OK) {
        ESP_LOGE(TAG, "Turbidity sensor init failed");
    }
    if (sonar_sensor_init() != ESP_OK) {
        ESP_LOGE(TAG, "Sonar sensor init failed");
    }

    // --- CAN bus ---
    can_bus_init();

    vTaskDelay(pdMS_TO_TICKS(1000));
    ESP_LOGI(TAG, "Sensor board started.");

    while (1) {
        // --- Thermistor ---
        float tempC = 25.0f;
        esp_err_t temp_ret = thermistor_read(&tempC);
        if (temp_ret == ESP_OK) {
            float tempF = tempC * (9.0f / 5.0f) + 32.0f;
            ESP_LOGI(TAG, "Temp: %.2f F", tempF);
            can_bus_send_float(CAN_ID_TEMPERATURE, tempC);
        } else if (temp_ret != ESP_ERR_INVALID_RESPONSE) {
            ESP_LOGE(TAG, "Thermistor read failed: %s", esp_err_to_name(temp_ret));
        }

        // --- pH ---
        float phValue = 0.0f, phVoltage = 0.0f;
        esp_err_t ph_ret = ph_sensor_read(&phValue, &phVoltage);
        if (ph_ret == ESP_OK) {
            ESP_LOGI(TAG, "pH:   %.2f | %.1f mV", phValue, phVoltage);
            can_bus_send_float(CAN_ID_PH, phValue);
        } else {
            ESP_LOGE(TAG, "pH read failed: %s", esp_err_to_name(ph_ret));
        }

        // --- EC ---
        float ecValue = 0.0f, ecVoltage = 0.0f;
        esp_err_t ec_ret = ec_sensor_read(tempC, &ecValue, &ecVoltage);
        if (ec_ret == ESP_OK) {
            ESP_LOGI(TAG, "EC:   %.2f ms/cm | %.1f mV", ecValue, ecVoltage);
            can_bus_send_float(CAN_ID_EC, ecValue);
        } else {
            ESP_LOGE(TAG, "EC read failed: %s", esp_err_to_name(ec_ret));
        }

        // --- Turbidity ---
        float turbNtu = 0.0f, turbVoltage = 0.0f;
        esp_err_t turb_ret = turbidity_sensor_read(&turbNtu, &turbVoltage);
        if (turb_ret == ESP_OK) {
            ESP_LOGI(TAG, "Turb: %.1f NTU | %.2f V", turbNtu, turbVoltage);
            can_bus_send_float(CAN_ID_TURBIDITY, turbNtu);
        } else {
            ESP_LOGE(TAG, "Turbidity read failed: %s", esp_err_to_name(turb_ret));
        }

        // --- Sonar ---
        float sonarMm = 0.0f;
        esp_err_t sonar_ret = sonar_sensor_read(&sonarMm);
        if (sonar_ret == ESP_OK) {
            ESP_LOGI(TAG, "Sonar: %.0f mm", sonarMm);
            can_bus_send_float(CAN_ID_SONAR, sonarMm);
        } else {
            ESP_LOGE(TAG, "Sonar read failed: %s", esp_err_to_name(sonar_ret));
        }

        // --- Update shared data for web dashboard ---
        sensor_snapshot_t snap = {
            .temp_f    = tempC * 9.0f / 5.0f + 32.0f,
            .ph        = phValue,
            .ec_ms_cm  = ecValue,
            .turb_ntu  = turbNtu,
            .sonar_mm  = sonarMm,
        };
        sensor_data_update(&snap);

        vTaskDelay(pdMS_TO_TICKS(500));
    }
}
