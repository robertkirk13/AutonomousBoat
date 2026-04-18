#include "sonar_sensor.h"
#include "driver/uart.h"
#include "driver/gpio.h"
#include "esp_log.h"

static const char *TAG = "SONAR";

#define FRAME_HEADER    0xFF
#define UART_BUF_SIZE   256
#define READ_TIMEOUT_MS 350  // sensor auto-transmits every 100ms; 350ms covers 3 cycles

esp_err_t sonar_sensor_init(void)
{
    gpio_reset_pin(SONAR_ENABLE_GPIO);
    gpio_set_direction(SONAR_ENABLE_GPIO, GPIO_MODE_OUTPUT);
    gpio_set_level(SONAR_ENABLE_GPIO, 1);

    gpio_reset_pin(SONAR_RX_GPIO);
    gpio_reset_pin(SONAR_TX_GPIO);

    uart_config_t cfg = {
        .baud_rate  = 115200,
        .data_bits  = UART_DATA_8_BITS,
        .parity     = UART_PARITY_DISABLE,
        .stop_bits  = UART_STOP_BITS_1,
        .flow_ctrl  = UART_HW_FLOWCTRL_DISABLE,
    };

    esp_err_t ret = uart_driver_install(SONAR_UART_NUM, UART_BUF_SIZE, 0, 0, NULL, 0);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "UART driver install failed: %s", esp_err_to_name(ret));
        return ret;
    }

    ret = uart_param_config(SONAR_UART_NUM, &cfg);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "UART param config failed: %s", esp_err_to_name(ret));
        return ret;
    }

    ret = uart_set_pin(SONAR_UART_NUM, SONAR_TX_GPIO, SONAR_RX_GPIO,
                       UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "UART set pin failed: %s", esp_err_to_name(ret));
        return ret;
    }

    ESP_LOGI(TAG, "Initialized on UART1 RX=GPIO%d TX=GPIO%d", (int)SONAR_RX_GPIO, (int)SONAR_TX_GPIO);
    return ESP_OK;
}

esp_err_t sonar_sensor_read(float *distance_mm_out)
{
    uart_flush_input(SONAR_UART_NUM);
    const uint8_t trigger = 0x55;
    uart_write_bytes(SONAR_UART_NUM, &trigger, 1);

    uint8_t byte;
    int received;

    while (true) {
        received = uart_read_bytes(SONAR_UART_NUM, &byte, 1, pdMS_TO_TICKS(READ_TIMEOUT_MS));
        if (received <= 0) {
            ESP_LOGW(TAG, "Timeout waiting for header");
            return ESP_ERR_TIMEOUT;
        }
        if (byte == FRAME_HEADER) break;
    }

    uint8_t buf[3];
    received = uart_read_bytes(SONAR_UART_NUM, buf, 3, pdMS_TO_TICKS(50));
    if (received < 3) {
        ESP_LOGW(TAG, "Timeout reading payload");
        return ESP_ERR_TIMEOUT;
    }

    uint8_t checksum = (uint8_t)(FRAME_HEADER + buf[0] + buf[1]);
    if (checksum != buf[2]) {
        ESP_LOGW(TAG, "Checksum mismatch: calc=0x%02X got=0x%02X", checksum, buf[2]);
        return ESP_ERR_INVALID_RESPONSE;
    }

    if (distance_mm_out) {
        *distance_mm_out = (float)((buf[0] << 8) | buf[1]);
    }

    return ESP_OK;
}
