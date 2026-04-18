#pragma once

#include "esp_err.h"
#include "driver/gpio.h"
#include <stdint.h>
#include <stddef.h>

// --- CAN GPIO --- configure to match your transceiver wiring
#define CAN_TX_GPIO     GPIO_NUM_3
#define CAN_RX_GPIO     GPIO_NUM_9

// --- Sensor message IDs (11-bit standard frame) ---
#define CAN_ID_TEMPERATURE  0x100U
#define CAN_ID_PH           0x101U
#define CAN_ID_EC           0x102U
#define CAN_ID_TURBIDITY    0x103U
#define CAN_ID_SONAR        0x104U

/**
 * @brief Initialize the TWAI (CAN) peripheral at 500 kbps.
 *
 * Installs the driver and starts the controller. Must be called once
 * before any send/receive calls. Requires a CAN transceiver (e.g.
 * SN65HVD230) connected to CAN_TX_GPIO / CAN_RX_GPIO.
 */
esp_err_t can_bus_init(void);

/**
 * @brief Transmit a float value as a 4-byte CAN frame.
 *
 * Encodes the float as little-endian IEEE 754 in the data field.
 *
 * @param can_id  11-bit standard CAN identifier.
 * @param value   Value to transmit.
 */
esp_err_t can_bus_send_float(uint32_t can_id, float value);

/**
 * @brief Receive the next CAN frame (blocking with timeout).
 *
 * @param can_id_out  Populated with the received frame identifier.
 * @param data_out    Buffer for the received data bytes (must be >= 8 bytes).
 * @param len_out     Populated with the number of data bytes received.
 * @param timeout_ms  Maximum wait time in milliseconds.
 * @return ESP_OK on success, ESP_ERR_TIMEOUT if no frame arrived.
 */
esp_err_t can_bus_receive(uint32_t *can_id_out, uint8_t *data_out,
                          uint8_t *len_out, uint32_t timeout_ms);
