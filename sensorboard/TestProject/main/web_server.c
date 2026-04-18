#include "web_server.h"
#include "sensor_data.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include <stdio.h>

static const char *TAG = "WEB_SERVER";

extern const uint8_t web_page_html_start[] asm("_binary_web_page_html_start");
extern const uint8_t web_page_html_end[]   asm("_binary_web_page_html_end");

static esp_err_t root_handler(httpd_req_t *req)
{
    size_t len = web_page_html_end - web_page_html_start;
    httpd_resp_set_type(req, "text/html");
    return httpd_resp_send(req, (const char *)web_page_html_start, (ssize_t)len);
}

static esp_err_t data_handler(httpd_req_t *req)
{
    sensor_snapshot_t snap;
    sensor_data_get(&snap);

    char json[160];
    snprintf(json, sizeof(json),
        "{\"temp_f\":%.1f,\"ph\":%.2f,\"ec\":%.2f,\"ntu\":%.0f,\"sonar_mm\":%.0f}",
        snap.temp_f, snap.ph, snap.ec_ms_cm, snap.turb_ntu, snap.sonar_mm);

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Cache-Control", "no-cache");
    return httpd_resp_send(req, json, HTTPD_RESP_USE_STRLEN);
}

esp_err_t web_server_init(void)
{
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    httpd_handle_t server = NULL;

    esp_err_t ret = httpd_start(&server, &config);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start HTTP server: %s", esp_err_to_name(ret));
        return ret;
    }

    httpd_uri_t root_uri = { .uri = "/",     .method = HTTP_GET, .handler = root_handler };
    httpd_uri_t data_uri = { .uri = "/data", .method = HTTP_GET, .handler = data_handler };

    httpd_register_uri_handler(server, &root_uri);
    httpd_register_uri_handler(server, &data_uri);

    ESP_LOGI(TAG, "HTTP server started");
    return ESP_OK;
}
