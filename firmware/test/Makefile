# 펌웨어 로직을 호스트에서 컴파일해 돌리는 테스트
# (장치에 올라가는 io_manager.cpp / app_logic.cpp 를 그대로 사용한다)
CXX      ?= g++
CXXFLAGS ?= -std=c++17 -Wall -Wextra -Wno-unused-parameter -O1 -g
INCLUDES  = -Istub -I../include -I../src
SRC       = test_logic.cpp stub/stub.cpp ../src/io_manager.cpp ../src/app_logic.cpp
BIN       = build/test_logic

.PHONY: test clean
test: $(BIN)
	@$(BIN)

$(BIN): $(SRC) stub/Arduino.h ../src/io_manager.h ../src/app_logic.h
	@mkdir -p build
	@$(CXX) $(CXXFLAGS) $(INCLUDES) $(SRC) -o $@

clean:
	@rm -rf build
