#include "turbidity_sensor.h"
#include "esp_log.h"

static const char *TAG = "TURBIDITY";

#define ADC_SAMPLES     50
#define ADC_MAX         4095.0f
#define VCC             3.3f
#define DIVIDER_FACTOR  2.0f    // 10k/10k voltage divider on sensor output

static adc_oneshot_unit_handle_t s_adc_handle = NULL;

esp_err_t turbidity_sensor_init(adc_oneshot_unit_handle_t adc_handle)
{
    s_adc_handle = adc_handle;

    adc_oneshot_chan_cfg_t chan_cfg = {
        .atten    = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_12,
    };
    esp_err_t ret = adc_oneshot_config_channel(s_adc_handle, TURB_ADC_CHANNEL, &chan_cfg);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "ADC channel config failed: %s", esp_err_to_name(ret));
        return ret;
    }

    gpio_reset_pin(TURB_ENABLE_GPIO);
    gpio_set_direction(TURB_ENABLE_GPIO, GPIO_MODE_OUTPUT);
    gpio_set_level(TURB_ENABLE_GPIO, 1);

    ESP_LOGI(TAG, "Initialized on GPIO4 (ADC1 CH3), enable GPIO5.");
    return ESP_OK;
}

esp_err_t turbidity_sensor_read(float *ntu_out, float *voltage_out)
{
    if (!s_adc_handle) {
        return ESP_ERR_INVALID_STATE;
    }

    int32_t sum = 0;
    for (int i = 0; i < ADC_SAMPLES; i++) {
        int raw = 0;
        esp_err_t ret = adc_oneshot_read(s_adc_handle, TURB_ADC_CHANNEL, &raw);
        if (ret != ESP_OK) {
            return ret;
        }
        sum += raw;
    }

    float pin_voltage    = ((float)(sum / ADC_SAMPLES) / ADC_MAX) * VCC;
    float sensor_voltage = pin_voltage * DIVIDER_FACTOR;

    if (voltage_out) *voltage_out = sensor_voltage;

    // Quadratic NTU formula from DFRobot datasheet (valid 2.5V–4.3V sensor output)
    // NTU = -1120.4*V^2 + 5742.3*V - 4352.9
    float ntu = 0.0f;
    if (sensor_voltage >= TURB_VOLTAGE_MAX) {
        ntu = 0.0f;
    } else if (sensor_voltage <= TURB_VOLTAGE_MIN) {
        ntu = 3000.0f;
    } else {
        float v = sensor_voltage;
        ntu = -1120.4f * v * v + 5742.3f * v - 4352.9f;
        if (ntu < 0.0f)   ntu = 0.0f;
        if (ntu > 3000.0f) ntu = 3000.0f;
    }

    if (ntu_out) *ntu_out = ntu;

    return ESP_OK;
}
