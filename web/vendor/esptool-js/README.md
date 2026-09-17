# esptool-js (vendored)

브라우저에서 Web Serial 로 ESP32 계열 칩의 ROM 부트로더와 통신해
플래시를 굽는 Espressif 공식 라이브러리.

| 항목 | 값 |
|---|---|
| 패키지 | [esptool-js](https://github.com/espressif/esptool-js) |
| 버전 | 0.6.1 |
| 라이선스 | Apache-2.0 (`LICENSE` 참고) |
| 파일 | `esptool.js` = npm 패키지의 `bundle.js` 를 그대로 복사한 것 |
| SHA-256 | `ef7d5a237d3f273ecf546bcee65dddad90bd82cf02f22a980d1537e0cd79a152` |

## 왜 벤더링했나

- 이 번들은 **자체 완결형**이다. 플래셔 스텁(각 칩별)과 pako(zlib)까지
  안에 들어 있어서, 네트워크가 없는 장비실에서도 그대로 동작한다.
- CDN 에서 받아 쓰면 오프라인 환경에서 플래시를 못 굽는다.

## 갱신 방법

```bash
npm pack esptool-js@<버전>
tar xzf esptool-js-<버전>.tgz
cp package/bundle.js web/vendor/esptool-js/esptool.js
cp package/LICENSE   web/vendor/esptool-js/LICENSE
```

갱신 후에는 위 표의 버전과 SHA-256 을 함께 고쳐 둘 것.
