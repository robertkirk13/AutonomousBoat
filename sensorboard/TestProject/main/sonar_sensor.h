#pragma once

#include "esp_err.h"
#include "driver/gpio.h"

#define SONAR_UART_NUM      UART_NUM_1
#define SONAR_RX_GPIO       GPIO_NUM_42
#define SONAR_TX_GPIO       GPIO_NUM_41
#define SONAR_ENABLE_GPIO   GPIO_NUM_40

esp_err_t sonar_sensor_init(void);

/**
 * @brief Read the latest distance from the sonar sensor.
 *
 * Flushes stale UART data, waits for a fresh 4-byte frame,
 * validates header (0xFF) and checksum, then returns distance.
 *
 * @param distance_mm_out  Distance in mm. NULL if read fails.
 * @return ESP_OK on success, ESP_ERR_TIMEOUT or ESP_ERR_INVALID_RESPONSE on failure.
 */
esp_err_t sonar_sensor_read(float *distance_mm_out);
