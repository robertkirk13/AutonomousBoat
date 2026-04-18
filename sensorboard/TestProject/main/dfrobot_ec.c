/*
 * dfrobot_ec.c
 *
 * Pure C driver for Gravity: Analog Electrical Conductivity Sensor V2 (K=1.0)
 * SKU: DFR0300
 *
 * Converted from the DFRobot Arduino C++ library for use with ESP-IDF.
 * Uses NVS for calibration storage instead of Arduino EEPROM.
 *
 * Original: https://github.com/DFRobot/DFRobot_EC
 * Copyright DFRobot, 2018 (GNU Lesser General Public License)
 */

#include "dfrobot_ec.h"

#include <string.h>
#include <ctype.h>
#include <math.h>

#include "esp_log.h"
#include "nvs_flash.h"
#include "nvs.h"

static const char *TAG = "dfrobot_ec";

/* Circuit constants from the DFRobot signal conditioning board */
#define RES2    820.0f   /* reference resistor value */
#define ECREF   200.0f   /* reference EC value */

/* NVS namespace and keys for calibration persistence */
#define NVS_NAMESPACE   "ec_cal"
#define NVS_KEY_KLOW    "kvalue_low"
#define NVS_KEY_KHIGH   "kvalue_high"

/* Temperature compensation coefficient */
#define TEMP_COEFF      0.0185f

/* Threshold to switch between low and high K values (raw EC) */
#define EC_RANGE_THRESH 2.0f

/* Standard calibration buffer solution values (ms/cm) */
#define CAL_SOLUTION_LOW   1.413f
#define CAL_SOLUTION_HIGH  12.88f


/* --------------- NVS helpers --------------- */

static void nvs_write_float(const char *key, float value)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "NVS open failed: %s", esp_err_to_name(err));
        return;
    }
    uint32_t raw;
    memcpy(&raw, &value, sizeof(raw));
    nvs_set_u32(handle, key, raw);
    nvs_commit(handle);
    nvs_close(handle);
}

static float nvs_read_float(const char *key, float default_val)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle);
    if (err != ESP_OK) {
        return default_val;
    }
    uint32_t raw = 0;
    err = nvs_get_u32(handle, key, &raw);
    nvs_close(handle);
    if (err != ESP_OK) {
        return default_val;
    }
    float result;
    memcpy(&result, &raw, sizeof(result));
    /* sanity check: if the value is wildly out of range, return default */
    if (result < 0.01f || result > 100.0f) {
        return default_val;
    }
    return result;
}


/* --------------- Public API --------------- */

int dfrobot_ec_begin(dfrobot_ec_t *ec)
{
    if (ec == NULL) {
        return -1;
    }

    memset(ec, 0, sizeof(*ec));
    ec->temperature = 25.0f;

    /* Load calibration K values from NVS (default 1.0 if not yet calibrated) */
    ec->kvalue_low  = nvs_read_float(NVS_KEY_KLOW,  1.0f);
    ec->kvalue_high = nvs_read_float(NVS_KEY_KHIGH, 1.0f);
    ec->kvalue      = ec->kvalue_low;

    ESP_LOGI(TAG, "EC sensor initialized  kvalue_low=%.4f  kvalue_high=%.4f",
             ec->kvalue_low, ec->kvalue_high);

    return 0; /* ESP_OK */
}

float dfrobot_ec_read(dfrobot_ec_t *ec, float voltage, float temperature)
{
    float value;
    float value_temp;

    ec->voltage     = voltage;
    ec->temperature = temperature;

    /* Raw EC from voltage divider */
    ec->raw_ec = 1000.0f * voltage / RES2 / ECREF;

    /* Select K value based on raw EC range */
    value_temp = ec->raw_ec * ec->kvalue_low;
    if (value_temp > EC_RANGE_THRESH) {
        ec->kvalue = ec->kvalue_high;
    } else {
        ec->kvalue = ec->kvalue_low;
    }

    /* Apply selected K value and temperature compensation */
    value = ec->raw_ec * ec->kvalue;
    value = value / (1.0f + TEMP_COEFF * (temperature - 25.0f));

    ec->ec_value = value;
    return value;
}

void dfrobot_ec_calibration(dfrobot_ec_t *ec, float voltage, float temperature, const char *cmd)
{
    static bool cal_mode = false;
    static float cal_kvalue_low  = 1.0f;
    static float cal_kvalue_high = 1.0f;

    if (cmd == NULL || ec == NULL) {
        return;
    }

    /* Convert command to uppercase for comparison */
    char cmd_upper[16] = {0};
    size_t len = strlen(cmd);
    if (len >= sizeof(cmd_upper)) {
        len = sizeof(cmd_upper) - 1;
    }
    for (size_t i = 0; i < len; i++) {
        cmd_upper[i] = (char)toupper((unsigned char)cmd[i]);
    }

    ec->voltage     = voltage;
    ec->temperature = temperature;

    if (strcmp(cmd_upper, "ENTEREC") == 0) {
        /* Enter calibration mode */
        cal_mode = true;
        cal_kvalue_low  = ec->kvalue_low;
        cal_kvalue_high = ec->kvalue_high;
        ESP_LOGI(TAG, ">>> Enter EC calibration mode <<<");

    } else if (strcmp(cmd_upper, "EXITEC") == 0) {
        /* Save calibration and exit */
        if (cal_mode) {
            ec->kvalue_low  = cal_kvalue_low;
            ec->kvalue_high = cal_kvalue_high;
            ec->kvalue      = ec->kvalue_low;

            nvs_write_float(NVS_KEY_KLOW,  ec->kvalue_low);
            nvs_write_float(NVS_KEY_KHIGH, ec->kvalue_high);

            ESP_LOGI(TAG, "Calibration saved  kvalue_low=%.4f  kvalue_high=%.4f",
                     ec->kvalue_low, ec->kvalue_high);
        }
        cal_mode = false;
        ESP_LOGI(TAG, ">>> Exit EC calibration mode <<<");

    } else if (strcmp(cmd_upper, "CALEC") == 0) {
        if (!cal_mode) {
            ESP_LOGW(TAG, "Not in calibration mode. Send 'enterec' first.");
            return;
        }

        /* Compute raw EC with temperature compensation */
        ec->raw_ec = 1000.0f * voltage / RES2 / ECREF;
        float raw_ec_at_25 = ec->raw_ec * (1.0f + TEMP_COEFF * (temperature - 25.0f));

        /* Auto-detect which standard buffer is in use */
        if (raw_ec_at_25 > 0.9f && raw_ec_at_25 < 1.9f) {
            /* 1413 us/cm buffer detected */
            float comp_solution = CAL_SOLUTION_LOW * (1.0f + TEMP_COEFF * (temperature - 25.0f));
            float k_temp = RES2 * ECREF * comp_solution / 1000.0f / voltage;
            cal_kvalue_low = k_temp;
            ESP_LOGI(TAG, "Low buffer (1413 us/cm) detected. K_low = %.4f", k_temp);

        } else if (raw_ec_at_25 > 9.0f && raw_ec_at_25 < 16.8f) {
            /* 12.88 ms/cm buffer detected */
            float comp_solution = CAL_SOLUTION_HIGH * (1.0f + TEMP_COEFF * (temperature - 25.0f));
            float k_temp = RES2 * ECREF * comp_solution / 1000.0f / voltage;
            cal_kvalue_high = k_temp;
            ESP_LOGI(TAG, "High buffer (12.88 ms/cm) detected. K_high = %.4f", k_temp);

        } else {
            ESP_LOGW(TAG, "Buffer not recognized (raw_ec_at_25 = %.2f). "
                     "Use 1413us/cm or 12.88ms/cm standard solution.", raw_ec_at_25);
        }
    }
}
