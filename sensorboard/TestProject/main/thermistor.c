#include "thermistor.h"
#include "esp_log.h"
#include <math.h>

static const char *TAG = "THERMISTOR";

#define ADC_SAMPLES 50

static adc_oneshot_unit_handle_t s_adc_handle = NULL;

static float read_resistance(void)
{
    int32_t sum = 0;
    for (int i = 0; i < ADC_SAMPLES; i++) {
        int raw = 0;
        adc_oneshot_read(s_adc_handle, THERM_ADC_CHANNEL, &raw);
        sum += raw;
    }
    int avg = sum / ADC_SAMPLES;
    if (avg <= 0) return -1.0f;
    // VCC ratio required — circuit runs at 5V, ADC reference is 3.3V
    float vcc_ratio = THERM_VCC_CIRCUIT / THERM_VCC_ADC;
    return THERM_SERIES_RESISTOR * ((vcc_ratio * THERM_ADC_MAX / (float)avg) - 1.0f);
}

esp_err_t thermistor_init(adc_oneshot_unit_handle_t adc_handle)
{
    s_adc_handle = adc_handle;

    adc_oneshot_chan_cfg_t chan_cfg = {
        .atten    = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_12,
    };
    esp_err_t ret = adc_oneshot_config_channel(s_adc_handle, THERM_ADC_CHANNEL, &chan_cfg);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "ADC channel config failed: %s", esp_err_to_name(ret));
        return ret;
    }

    gpio_reset_pin(THERM_ENABLE_GPIO);
    gpio_set_direction(THERM_ENABLE_GPIO, GPIO_MODE_OUTPUT);
    gpio_set_level(THERM_ENABLE_GPIO, 1);

    ESP_LOGI(TAG, "Initialized. Using Steinhart-Hart: A=%.4e B=%.4e C=%.4e",
             THERM_SH_A, THERM_SH_B, THERM_SH_C);
    return ESP_OK;
}

esp_err_t thermistor_read(float *temp_c_out)
{
    if (!s_adc_handle) return ESP_ERR_INVALID_STATE;

    float resistance = read_resistance();
    if (resistance < 0.0f) return ESP_ERR_INVALID_RESPONSE;

    ESP_LOGI(TAG, "Resistance: %.1f ohm", resistance);
    float lnR    = logf(resistance);
    float inv_T  = THERM_SH_A + THERM_SH_B * lnR + THERM_SH_C * lnR * lnR * lnR;
    *temp_c_out  = (1.0f / inv_T) - 273.15f;

    return ESP_OK;
}
