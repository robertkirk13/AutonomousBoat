#include "can_bus.h"
#include "driver/twai.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include <string.h>

static const char *TAG = "CAN_BUS";

esp_err_t can_bus_init(void)
{
    twai_general_config_t g_config =
        TWAI_GENERAL_CONFIG_DEFAULT(CAN_TX_GPIO, CAN_RX_GPIO, TWAI_MODE_NORMAL);
    twai_timing_config_t  t_config = TWAI_TIMING_CONFIG_500KBITS();
    twai_filter_config_t  f_config = TWAI_FILTER_CONFIG_ACCEPT_ALL();

    esp_err_t ret = twai_driver_install(&g_config, &t_config, &f_config);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Driver install failed: %s", esp_err_to_name(ret));
        return ret;
    }

    ret = twai_start();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Start failed: %s", esp_err_to_name(ret));
        twai_driver_uninstall();
        return ret;
    }

    ESP_LOGI(TAG, "Initialized at 500 kbps. TX=GPIO%d RX=GPIO%d",
             CAN_TX_GPIO, CAN_RX_GPIO);
    return ESP_OK;
}

esp_err_t can_bus_send_float(uint32_t can_id, float value)
{
    twai_message_t msg = {
        .identifier       = can_id,
        .data_length_code = sizeof(float),
        .extd             = 0,
        .rtr              = 0,
    };
    memcpy(msg.data, &value, sizeof(float));

    esp_err_t ret = twai_transmit(&msg, pdMS_TO_TICKS(10));
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "TX failed (id=0x%03" PRIx32 "): %s",
                 can_id, esp_err_to_name(ret));
    }
    return ret;
}

esp_err_t can_bus_receive(uint32_t *can_id_out, uint8_t *data_out,
                          uint8_t *len_out, uint32_t timeout_ms)
{
    twai_message_t msg;
    esp_err_t ret = twai_receive(&msg, pdMS_TO_TICKS(timeout_ms));
    if (ret != ESP_OK) {
        return ret;
    }

    if (can_id_out) *can_id_out = msg.identifier;
    if (len_out)    *len_out    = msg.data_length_code;
    if (data_out)   memcpy(data_out, msg.data, msg.data_length_code);

    return ESP_OK;
}
