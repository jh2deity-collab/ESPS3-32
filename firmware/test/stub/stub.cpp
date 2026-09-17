#include "Arduino.h"

FakeGpio g_fakeGpio[64];
uint32_t g_fakeMillis = 1000;
int      g_ledcDuty[16] = {0};
uint32_t g_ledcFreq[16] = {0};
uint8_t  g_ledcRes[16]  = {0};

#include "Update.h"
#include "esp_ota_ops.h"

bool      g_fakeRestarted = false;
EspClass  ESP;

UpdateClass Update;

bool            g_fakeHasOtaPartition = true;
esp_partition_t g_fakeRunningPartition = {"app0", 0x330000};
esp_partition_t g_fakeNextPartition    = {"app1", 0x330000};
