#include "Arduino.h"

FakeGpio g_fakeGpio[64];
uint32_t g_fakeMillis = 1000;
int      g_ledcDuty[16] = {0};
uint32_t g_ledcFreq[16] = {0};
uint8_t  g_ledcRes[16]  = {0};
