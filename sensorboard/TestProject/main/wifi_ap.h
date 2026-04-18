#pragma once

#include "esp_err.h"

#define WIFI_AP_SSID      "BoatSensors"
#define WIFI_AP_PASS      "boatboard1"
#define WIFI_AP_CHANNEL   1
#define WIFI_AP_MAX_CONN  4

esp_err_t wifi_ap_init(void);
