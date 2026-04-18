#include "ph_sensor.h"
#include "esp_log.h"
#include "nvs.h"
#include <string.h>

static const char *TAG = "PH_SENSOR";

#define NVS_NAMESPACE    "ph-config"
#define NVS_KEY_NEUTRAL  "neutral"
#define NVS_KEY_ACID     "acid"

// Number of ADC samples to average per reading
#define ADC_SAMPLES      50
#define ADC_MAX          4095.0f
#define VCC_MV           3300.0f

static adc_oneshot_unit_handle_t s_adc_handle = NULL;
static float s_neutral_mv = PH_NEUTRAL_MV_DEFAULT;
static float s_acid_mv    = PH_ACID_MV_DEFAULT;

esp_err_t ph_sensor_init(adc_oneshot_unit_handle_t adc_handle)
{
    s_adc_handle = adc_handle;

    // Configure this sensor's ADC channel on the shared unit handle
    adc_oneshot_chan_cfg_t chan_cfg = {
        .atten    = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_12,
    };
    esp_err_t ret = adc_oneshot_config_channel(s_adc_handle, PH_ADC_CHANNEL, &chan_cfg);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "ADC channel config failed: %s", esp_err_to_name(ret));
        return ret;
    }

    // Enable pin - held HIGH to power the probe circuit
    gpio_reset_pin(PH_ENABLE_GPIO);
    gpio_set_direction(PH_ENABLE_GPIO, GPIO_MODE_OUTPUT);
    gpio_set_level(PH_ENABLE_GPIO, 1);

    ph_sensor_load_calibration();

    ESP_LOGI(TAG, "Initialized. Neutral: %.1f mV, Acid: %.1f mV", s_neutral_mv, s_acid_mv);
    return ESP_OK;
}

esp_err_t ph_sensor_read(float *ph_out, float *voltage_mv_out)
{
    if (!s_adc_handle) {
        return ESP_ERR_INVALID_STATE;
    }

    int32_t sum = 0;
    for (int i = 0; i < ADC_SAMPLES; i++) {
        int raw = 0;
        esp_err_t ret = adc_oneshot_read(s_adc_handle, PH_ADC_CHANNEL, &raw);
        if (ret != ESP_OK) {
            return ret;
        }
        sum += raw;
    }

    float voltage_mv = ((float)(sum / ADC_SAMPLES) * VCC_MV) / ADC_MAX;

    // Two-point linear calibration: rate = mV per pH unit
    float rate = (s_acid_mv - s_neutral_mv) / (4.0f - 7.0f);
    float ph   = 7.0f + (voltage_mv - s_neutral_mv) / rate;

    if (voltage_mv_out) *voltage_mv_out = voltage_mv;
    if (ph_out)         *ph_out         = ph;

    return ESP_OK;
}

esp_err_t ph_sensor_calibrate(void)
{
    float voltage_mv = 0.0f;
    esp_err_t ret = ph_sensor_read(NULL, &voltage_mv);
    if (ret != ESP_OK) {
        return ret;
    }

    // Auto-detect buffer: neutral buffer sits near 1500 mV, acid is higher
    if (voltage_mv > 1300.0f && voltage_mv < 1700.0f) {
        s_neutral_mv = voltage_mv;
        ESP_LOGI(TAG, "Calibrated neutral (pH 7.0) at %.1f mV", s_neutral_mv);
    } else {
        s_acid_mv = voltage_mv;
        ESP_LOGI(TAG, "Calibrated acid (pH 4.0) at %.1f mV", s_acid_mv);
    }

    return ph_sensor_save_calibration();
}

esp_err_t ph_sensor_save_calibration(void)
{
    nvs_handle_t handle;
    esp_err_t ret = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "NVS open failed: %s", esp_err_to_name(ret));
        return ret;
    }

    // NVS has no native float type; reinterpret as uint32
    uint32_t neutral_bits = 0, acid_bits = 0;
    memcpy(&neutral_bits, &s_neutral_mv, sizeof(float));
    memcpy(&acid_bits,    &s_acid_mv,    sizeof(float));

    nvs_set_u32(handle, NVS_KEY_NEUTRAL, neutral_bits);
    nvs_set_u32(handle, NVS_KEY_ACID,    acid_bits);
    ret = nvs_commit(handle);
    nvs_close(handle);

    if (ret == ESP_OK) {
        ESP_LOGI(TAG, "Calibration saved to NVS.");
    }
    return ret;
}

esp_err_t ph_sensor_load_calibration(void)
{
    nvs_handle_t handle;
    esp_err_t ret = nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle);
    if (ret == ESP_ERR_NVS_NOT_FOUND) {
        ESP_LOGW(TAG, "No saved calibration found, using defaults.");
        return ESP_OK;
    }
    if (ret != ESP_OK) {
        return ret;
    }

    uint32_t neutral_bits = 0, acid_bits = 0;
    if (nvs_get_u32(handle, NVS_KEY_NEUTRAL, &neutral_bits) == ESP_OK) {
        memcpy(&s_neutral_mv, &neutral_bits, sizeof(float));
    }
    if (nvs_get_u32(handle, NVS_KEY_ACID, &acid_bits) == ESP_OK) {
        memcpy(&s_acid_mv, &acid_bits, sizeof(float));
    }
    nvs_close(handle);

    ESP_LOGI(TAG, "Calibration loaded. Neutral: %.1f mV, Acid: %.1f mV", s_neutral_mv, s_acid_mv);
    return ESP_OK;
}
