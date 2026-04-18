#include "ec_sensor.h"
#include "dfrobot_ec.h"
#include "esp_log.h"

static const char *TAG = "EC_SENSOR";

#define ADC_SAMPLES     50
#define ADC_MAX         4095.0f
#define VCC_MV          3300.0f

static adc_oneshot_unit_handle_t s_adc_handle = NULL;
static dfrobot_ec_t s_ec;

esp_err_t ec_sensor_init(adc_oneshot_unit_handle_t adc_handle)
{
    s_adc_handle = adc_handle;

    adc_oneshot_chan_cfg_t chan_cfg = {
        .atten    = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_12,
    };
    esp_err_t ret = adc_oneshot_config_channel(s_adc_handle, EC_ADC_CHANNEL, &chan_cfg);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "ADC channel config failed: %s", esp_err_to_name(ret));
        return ret;
    }

    gpio_reset_pin(EC_ENABLE_GPIO);
    gpio_set_direction(EC_ENABLE_GPIO, GPIO_MODE_OUTPUT);
    gpio_set_level(EC_ENABLE_GPIO, 1);

    if (dfrobot_ec_begin(&s_ec) != 0) {
        ESP_LOGE(TAG, "EC driver init failed");
        return ESP_FAIL;
    }

    ESP_LOGI(TAG, "Initialized on GPIO6 (ADC1 CH5), enable GPIO7.");
    return ESP_OK;
}

esp_err_t ec_sensor_read(float temperature, float *ec_out, float *voltage_mv_out)
{
    if (!s_adc_handle) {
        return ESP_ERR_INVALID_STATE;
    }

    int32_t sum = 0;
    for (int i = 0; i < ADC_SAMPLES; i++) {
        int raw = 0;
        esp_err_t ret = adc_oneshot_read(s_adc_handle, EC_ADC_CHANNEL, &raw);
        if (ret != ESP_OK) {
            return ret;
        }
        sum += raw;
    }

    float voltage_mv = ((float)(sum / ADC_SAMPLES) * VCC_MV) / ADC_MAX;
    float ec = dfrobot_ec_read(&s_ec, voltage_mv, temperature);

    if (voltage_mv_out) *voltage_mv_out = voltage_mv;
    if (ec_out)         *ec_out         = ec;

    return ESP_OK;
}
