#pragma once
#include "esp_partition.h"

// 테스트가 OTA 파티션 유무/크기를 바꿀 수 있게 해 둔다
extern bool            g_fakeHasOtaPartition;
extern esp_partition_t g_fakeRunningPartition;
extern esp_partition_t g_fakeNextPartition;

inline const esp_partition_t* esp_ota_get_running_partition() {
  return &g_fakeRunningPartition;
}
inline const esp_partition_t* esp_ota_get_next_update_partition(const esp_partition_t*) {
  return g_fakeHasOtaPartition ? &g_fakeNextPartition : nullptr;
}
