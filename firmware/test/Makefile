# 펌웨어 로직을 호스트에서 컴파일해 돌리는 테스트
# (장치에 올라가는 io_manager.cpp / app_logic.cpp 를 그대로 사용한다)
CXX      ?= g++
CXXFLAGS ?= -std=c++17 -Wall -Wextra -Wno-unused-parameter -O1 -g
INCLUDES  = -Istub -I../include -I../src
COMMON    = stub/stub.cpp
LOGIC_SRC = test_logic.cpp $(COMMON) ../src/io_manager.cpp ../src/app_logic.cpp
OTA_SRC   = test_ota.cpp   $(COMMON) ../src/ota_manager.cpp
LOGIC_BIN = build/test_logic
OTA_BIN   = build/test_ota

.PHONY: test clean
test: $(LOGIC_BIN) $(OTA_BIN)
	@$(LOGIC_BIN)
	@$(OTA_BIN)

$(LOGIC_BIN): $(LOGIC_SRC) stub/Arduino.h ../src/io_manager.h ../src/app_logic.h
	@mkdir -p build
	@$(CXX) $(CXXFLAGS) $(INCLUDES) $(LOGIC_SRC) -o $@

$(OTA_BIN): $(OTA_SRC) stub/Arduino.h stub/Update.h stub/esp_ota_ops.h ../src/ota_manager.h
	@mkdir -p build
	@$(CXX) $(CXXFLAGS) $(INCLUDES) $(OTA_SRC) -o $@

clean:
	@rm -rf build
