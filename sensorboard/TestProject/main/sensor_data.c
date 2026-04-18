#include "sensor_data.h"
#include <string.h>

static sensor_snapshot_t s_data = {0};
static SemaphoreHandle_t s_mutex = NULL;

void sensor_data_init(void)
{
    s_mutex = xSemaphoreCreateMutex();
}

void sensor_data_update(const sensor_snapshot_t *snap)
{
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(10)) == pdTRUE) {
        s_data = *snap;
        xSemaphoreGive(s_mutex);
    }
}

void sensor_data_get(sensor_snapshot_t *snap)
{
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(10)) == pdTRUE) {
        *snap = s_data;
        xSemaphoreGive(s_mutex);
    }
}
