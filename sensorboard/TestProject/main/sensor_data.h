#pragma once

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

typedef struct {
    float temp_f;
    float ph;
    float ec_ms_cm;
    float turb_ntu;
    float sonar_mm;
} sensor_snapshot_t;

void sensor_data_init(void);
void sensor_data_update(const sensor_snapshot_t *snap);
void sensor_data_get(sensor_snapshot_t *snap);
