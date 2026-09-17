// 호스트 테스트용 Update 스텁.
// 실제 플래시 대신 메모리 버퍼에 쓰고, 크기/MD5 검사 결과를 흉내 낸다.
#pragma once
#include "Arduino.h"
#include <vector>

#define U_FLASH 0

class UpdateClass {
 public:
  bool begin(size_t size, int /*command*/ = U_FLASH) {
    if (running_) { err_ = "이미 진행 중"; return false; }
    if (size == 0 || size > capacity_) { err_ = "크기 초과"; return false; }
    expected_ = size;
    buffer_.clear();
    md5_.clear();
    running_ = true;
    err_ = "";
    return true;
  }

  size_t write(uint8_t* data, size_t len) {
    if (!running_) return 0;
    if (buffer_.size() + len > expected_) return 0;
    buffer_.insert(buffer_.end(), data, data + len);
    return failWriteAt_ && buffer_.size() >= failWriteAt_ ? 0 : len;
  }

  bool setMD5(const char* md5) {
    if (!md5 || strlen(md5) != 32) return false;
    md5_ = md5;
    return true;
  }

  bool end(bool evenIfRemaining = false) {
    if (!running_) { err_ = "진행 중 아님"; return false; }
    running_ = false;
    if (buffer_.size() != expected_) { err_ = "크기 불일치"; return false; }
    if (failEnd_) { err_ = "MD5 불일치"; return false; }
    (void)evenIfRemaining;
    return true;
  }

  void abort() { running_ = false; buffer_.clear(); }
  bool isRunning() const { return running_; }
  const char* errorString() const { return err_.c_str(); }

  // --- 테스트 조작용 -------------------------------------------------------
  void reset() {
    running_ = false; buffer_.clear(); md5_.clear(); err_ = "";
    expected_ = 0; failEnd_ = false; failWriteAt_ = 0;
  }
  const std::vector<uint8_t>& data() const { return buffer_; }
  const std::string& md5() const { return md5_; }
  void setCapacity(size_t c) { capacity_ = c; }
  void failEndWith(bool on) { failEnd_ = on; }
  void failWriteAfter(size_t bytes) { failWriteAt_ = bytes; }

 private:
  std::vector<uint8_t> buffer_;
  std::string md5_;
  std::string err_;
  size_t   expected_ = 0;
  size_t   capacity_ = 3 * 1024 * 1024;
  bool     running_ = false;
  bool     failEnd_ = false;
  size_t   failWriteAt_ = 0;
};

extern UpdateClass Update;
